import Fastify from 'fastify';
import { config } from './config.js';
import { logger } from './logger.js';
import {
  registerMerchant,
  removeMerchant,
  getAllMerchants,
  getMerchantCount,
} from './store.js';
import { refreshSubscriptions, getRelayStats } from './relay.js';
import { getWebhookStats } from './webhook.js';
import { RegisterMerchantSchema } from './types.js';
import { fetchWooCommerceProducts } from './woocommerce.js';
import { publishProducts, unpublishProducts } from './publish.js';

const startTime = Date.now();

export const app = Fastify({
  logger: false, // We use our own logger
});

/**
 * Verify admin token
 */
function verifyAdminToken(authHeader: string | undefined): boolean {
  if (!config.adminToken) return false;
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === config.adminToken;
}

// Health check
app.get('/health', async () => {
  return { status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000) };
});

// Stats
app.get('/api/stats', async () => {
  const relayStats = getRelayStats();
  const webhookStats = getWebhookStats();
  
  return {
    uptime: Math.floor((Date.now() - startTime) / 1000),
    merchants: getMerchantCount(),
    eventsReceived: relayStats.eventsReceived,
    eventsForwarded: webhookStats.eventsForwarded,
    eventsFailed: webhookStats.eventsFailed,
    relayConnections: relayStats.relayConnections,
  };
});

// List merchants (no secrets)
app.get('/api/merchants', async () => {
  return { merchants: getAllMerchants() };
});

// Register merchant
app.post('/api/merchants', async (request, reply) => {
  const authHeader = request.headers.authorization;
  
  if (!verifyAdminToken(authHeader)) {
    reply.code(401);
    return { error: 'Unauthorized' };
  }
  
  try {
    const data = RegisterMerchantSchema.parse(request.body);
    
    const merchant = await registerMerchant({
      pubkey: data.pubkey,
      name: data.name,
      webhookUrl: data.webhookUrl,
      webhookSecret: data.webhookSecret,
      btcpay: data.btcpay,
    });
    
    // Refresh relay subscriptions to include new merchant
    refreshSubscriptions();
    
    logger.info({ 
      pubkey: merchant.pubkey.slice(0, 16) + '...',
      mode: merchant.btcpay ? 'btcpay' : 'webhook',
    }, 'Merchant registered via API');
    
    return {
      success: true,
      merchant: {
        pubkey: merchant.pubkey,
        name: merchant.name,
        mode: merchant.btcpay ? 'btcpay' : 'webhook',
        enabled: merchant.enabled,
      },
    };
  } catch (err) {
    logger.error({ err }, 'Failed to register merchant');
    reply.code(400);
    return { error: err instanceof Error ? err.message : 'Invalid request' };
  }
});

// Remove merchant
app.delete('/api/merchants/:pubkey', async (request, reply) => {
  const authHeader = request.headers.authorization;
  
  if (!verifyAdminToken(authHeader)) {
    reply.code(401);
    return { error: 'Unauthorized' };
  }
  
  const { pubkey } = request.params as { pubkey: string };
  
  try {
    const deleted = await removeMerchant(pubkey);
    
    if (deleted) {
      // Refresh relay subscriptions to remove merchant
      refreshSubscriptions();
      return { success: true };
    } else {
      reply.code(404);
      return { error: 'Merchant not found' };
    }
  } catch (err) {
    logger.error({ err }, 'Failed to remove merchant');
    reply.code(400);
    return { error: err instanceof Error ? err.message : 'Invalid request' };
  }
});

// Publish WooCommerce products to Nostr/Shopstr
app.post('/api/publish', async (request, reply) => {
  const authHeader = request.headers.authorization;
  if (!verifyAdminToken(authHeader)) {
    reply.code(401);
    return { error: 'Unauthorized' };
  }

  if (!config.nostrPrivateKey || !config.nostrPubkey) {
    reply.code(400);
    return { error: 'NOSTR_PRIVATE_KEY and NOSTR_PUBKEY must be set' };
  }

  const wc = config.woocommerce;
  if (!wc.url || !wc.consumerKey || !wc.consumerSecret) {
    reply.code(400);
    return { error: 'WC_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET must be set' };
  }

  try {
    const products = await fetchWooCommerceProducts(wc);
    if (!products.length) {
      return { published: 0, failed: 0, message: 'No products found' };
    }

    const result = await publishProducts(
      products,
      config.nostrPrivateKey,
      config.nostrPubkey,
      config.listing.currency,
      config.listing.location,
    );

    return { ...result, total: products.length, relays: config.relays };
  } catch (err) {
    logger.error({ err }, 'Publish failed');
    reply.code(500);
    return { error: err instanceof Error ? err.message : 'Publish failed' };
  }
});

// Unpublish WooCommerce products from Nostr/Shopstr
app.post('/api/unpublish', async (request, reply) => {
  const authHeader = request.headers.authorization;
  if (!verifyAdminToken(authHeader)) {
    reply.code(401);
    return { error: 'Unauthorized' };
  }

  if (!config.nostrPrivateKey || !config.nostrPubkey) {
    reply.code(400);
    return { error: 'NOSTR_PRIVATE_KEY and NOSTR_PUBKEY must be set' };
  }

  const wc = config.woocommerce;
  if (!wc.url || !wc.consumerKey || !wc.consumerSecret) {
    reply.code(400);
    return { error: 'WC_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET must be set' };
  }

  try {
    const products = await fetchWooCommerceProducts(wc);
    if (!products.length) {
      return { unpublished: 0, failed: 0, message: 'No products found' };
    }

    const result = await unpublishProducts(
      products,
      config.nostrPrivateKey,
      config.nostrPubkey,
      config.listing.currency,
      config.listing.location,
    );

    return { ...result, total: products.length };
  } catch (err) {
    logger.error({ err }, 'Unpublish failed');
    reply.code(500);
    return { error: err instanceof Error ? err.message : 'Unpublish failed' };
  }
});

// Start server
export async function startServer(): Promise<void> {
  try {
    await app.listen({ port: config.port, host: config.host });
    logger.info({ port: config.port, host: config.host }, 'API server started');
  } catch (err) {
    logger.error({ err }, 'Failed to start API server');
    throw err;
  }
}
