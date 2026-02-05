import { logger } from './logger.js';

export interface BTCPayConfig {
  url: string;
  storeId: string;
  apiKey: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  currency: string;
}

export interface NostrOrder {
  orderId: string;
  customerPubkey: string;
  items: OrderItem[];
  shippingAddress?: {
    name?: string;
    street?: string;
    city?: string;
    region?: string;
    country?: string;
    zip?: string;
  };
  message?: string;
  contact?: string;
}

export interface BTCPayInvoice {
  id: string;
  checkoutLink: string;
  status: string;
  amount: string;
  currency: string;
}

/**
 * Parse NIP-15 order event content into structured order
 */
export function parseNostrOrder(eventContent: string, eventId: string, customerPubkey: string): NostrOrder | null {
  try {
    const parsed = JSON.parse(eventContent);
    
    // NIP-15 order format
    const order: NostrOrder = {
      orderId: parsed.id || eventId.slice(0, 16),
      customerPubkey,
      items: [],
      message: parsed.message,
      contact: parsed.contact,
    };
    
    // Parse items
    if (parsed.items && Array.isArray(parsed.items)) {
      for (const item of parsed.items) {
        order.items.push({
          productId: item.product_id || item.id || 'unknown',
          name: item.name || item.product_id || 'Item',
          quantity: parseInt(item.quantity, 10) || 1,
          price: parseFloat(item.price) || 0,
          currency: (item.currency || 'sats').toUpperCase(),
        });
      }
    }
    
    // Parse shipping address
    if (parsed.shipping) {
      order.shippingAddress = {
        name: parsed.shipping.name,
        street: parsed.shipping.street || parsed.shipping.address,
        city: parsed.shipping.city,
        region: parsed.shipping.region || parsed.shipping.state,
        country: parsed.shipping.country,
        zip: parsed.shipping.zip || parsed.shipping.postal_code,
      };
    }
    
    return order;
  } catch (err) {
    logger.warn({ err, eventId }, 'Failed to parse order content');
    return null;
  }
}

/**
 * Create BTCPay invoice from Nostr order
 */
export async function createBTCPayInvoice(
  config: BTCPayConfig,
  order: NostrOrder
): Promise<BTCPayInvoice | null> {
  // Calculate total in sats
  let totalSats = 0;
  for (const item of order.items) {
    if (item.currency === 'SATS' || item.currency === 'SAT') {
      totalSats += item.price * item.quantity;
    } else if (item.currency === 'BTC') {
      totalSats += item.price * item.quantity * 100_000_000;
    } else {
      // For fiat, we'll let BTCPay handle conversion
      // This is a simplified version - real implementation might need more logic
      logger.warn({ currency: item.currency }, 'Non-sats currency, passing to BTCPay as-is');
    }
  }
  
  // Build invoice request
  const invoiceRequest = {
    amount: totalSats > 0 ? (totalSats / 100_000_000).toFixed(8) : undefined,
    currency: totalSats > 0 ? 'BTC' : order.items[0]?.currency || 'USD',
    metadata: {
      orderId: order.orderId,
      customerPubkey: order.customerPubkey,
      items: order.items,
      shippingAddress: order.shippingAddress,
      source: 'nostr-order-listener',
    },
    checkout: {
      redirectURL: undefined,
      defaultLanguage: 'en',
    },
    receipt: {
      enabled: true,
    },
  };
  
  // If no sats total, calculate from items
  if (!invoiceRequest.amount && order.items.length > 0) {
    let total = 0;
    const currency = order.items[0].currency;
    for (const item of order.items) {
      total += item.price * item.quantity;
    }
    invoiceRequest.amount = total.toString();
    invoiceRequest.currency = currency;
  }
  
  const url = `${config.url}/api/v1/stores/${config.storeId}/invoices`;
  
  try {
    logger.info({ 
      url, 
      orderId: order.orderId,
      amount: invoiceRequest.amount,
      currency: invoiceRequest.currency,
    }, 'Creating BTCPay invoice');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `token ${config.apiKey}`,
      },
      body: JSON.stringify(invoiceRequest),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ 
        status: response.status, 
        error: errorText,
        orderId: order.orderId,
      }, 'BTCPay invoice creation failed');
      return null;
    }
    
    const invoice = await response.json();
    
    logger.info({
      invoiceId: invoice.id,
      orderId: order.orderId,
      checkoutLink: invoice.checkoutLink,
    }, 'BTCPay invoice created');
    
    return {
      id: invoice.id,
      checkoutLink: invoice.checkoutLink,
      status: invoice.status,
      amount: invoice.amount,
      currency: invoice.currency,
    };
  } catch (err) {
    logger.error({ err, orderId: order.orderId }, 'Failed to create BTCPay invoice');
    return null;
  }
}
