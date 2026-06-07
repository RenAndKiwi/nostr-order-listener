import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import type { EventTemplate } from 'nostr-tools/pure';
import WebSocket from 'ws';
import { config } from './config.js';
import { logger } from './logger.js';
import type { WcProduct } from './woocommerce.js';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function buildProductEvent(
  product: WcProduct,
  pubkeyHex: string,
  currency: string,
  location: string,
): EventTemplate {
  const now = Math.floor(Date.now() / 1000);
  const description = stripHtml(product.short_description || product.description || '');
  const image = product.images?.[0]?.src || '';

  const tags: string[][] = [
    ['d', product.id.toString()],
    ['title', product.name],
    ['summary', description],
    ['price', product.price || product.regular_price || '0', currency],
    ['location', location],
    ['status', (product.stock_status === 'instock' || product.in_stock) ? 'active' : 'sold'],
    ['t', 'shopstr'],
    ['published_at', now.toString()],
    ['client', 'BTCPayServer-Shopstr', `31990:${pubkeyHex}:nostr-order-listener`],
  ];

  for (const method of config.listing.shipping) {
    tags.push(['shipping', method]);
  }

  if (image) tags.push(['image', image]);
  if (product.stock_quantity != null) tags.push(['quantity', product.stock_quantity.toString()]);
  if (product.categories?.length) {
    for (const cat of product.categories) {
      tags.push(['t', cat.name.toLowerCase()]);
    }
  }

  return {
    created_at: now,
    kind: 30402,
    tags,
    content: description,
  };
}

function publishToRelay(relayUrl: string, signedEvent: any): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 10000);

    const ws = new WebSocket(relayUrl);

    ws.on('open', () => {
      ws.send(JSON.stringify(['EVENT', signedEvent]));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'OK' && msg[1] === signedEvent.id) {
          clearTimeout(timeout);
          ws.close();
          resolve(msg[2] === true);
        }
      } catch {}
    });

    ws.on('error', (err) => {
      logger.error({ relay: relayUrl, error: (err as Error).message }, 'Relay publish error');
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export async function publishProducts(
  products: WcProduct[],
  privateKeyHex: string,
  pubkeyHex: string,
  currency: string,
  location: string,
): Promise<{ published: number; failed: number }> {
  let published = 0;
  let failed = 0;
  const sk = hexToBytes(privateKeyHex);

  for (const product of products) {
    const template = buildProductEvent(product, pubkeyHex, currency, location);
    const signed = finalizeEvent(template, sk);

    logger.info({ productId: product.id, name: product.name, eventId: signed.id.slice(0, 16) }, 'Publishing product');

    const results = await Promise.all(
      config.relays.map((relay) => publishToRelay(relay, signed)),
    );

    if (results.some((r) => r)) {
      published++;
      logger.info({ productId: product.id, relays: results.filter(Boolean).length }, 'Product published');
    } else {
      failed++;
      logger.error({ productId: product.id }, 'Product failed to publish to any relay');
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return { published, failed };
}

export async function unpublishProducts(
  products: WcProduct[],
  privateKeyHex: string,
  pubkeyHex: string,
  currency: string,
  location: string,
): Promise<{ unpublished: number; failed: number }> {
  let unpublished = 0;
  let failed = 0;
  const sk = hexToBytes(privateKeyHex);

  for (const product of products) {
    const template: EventTemplate = {
      created_at: Math.floor(Date.now() / 1000),
      kind: 30402,
      tags: [
        ['d', product.id.toString()],
        ['title', '[UNPUBLISHED] ' + product.name],
        ['status', 'deleted'],
        ['client', 'BTCPayServer-Shopstr', `31990:${pubkeyHex}:nostr-order-listener`],
      ],
      content: '',
    };

    const signed = finalizeEvent(template, sk);

    const results = await Promise.all(
      config.relays.map((relay) => publishToRelay(relay, signed)),
    );

    if (results.some((r) => r)) {
      unpublished++;
    } else {
      failed++;
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return { unpublished, failed };
}
