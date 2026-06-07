import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3847', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  relays: (process.env.RELAYS || 'wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band')
    .split(',')
    .map(r => r.trim())
    .filter(Boolean),
  
  adminToken: process.env.ADMIN_TOKEN || '',
  merchantsFile: process.env.MERCHANTS_FILE || './merchants.json',

  // Nostr identity for publishing
  nostrPrivateKey: process.env.NOSTR_PRIVATE_KEY || '',
  nostrPubkey: process.env.NOSTR_PUBKEY || '',

  // WooCommerce connection
  woocommerce: {
    url: process.env.WC_URL || '',
    consumerKey: process.env.WC_CONSUMER_KEY || '',
    consumerSecret: process.env.WC_CONSUMER_SECRET || '',
  },

  // Product listing defaults
  listing: {
    currency: process.env.LISTING_CURRENCY || 'USD',
    location: process.env.LISTING_LOCATION || 'Worldwide',
    shipping: (process.env.LISTING_SHIPPING || 'Domestic,International').split(',').map(s => s.trim()).filter(Boolean),
  },
  
  // Webhook delivery settings
  webhook: {
    timeout: 10000, // 10 seconds
    maxRetries: 3,
    retryDelay: 1000, // Base delay, exponential backoff
  },
  
  // Relay connection settings
  relay: {
    reconnectDelay: 5000,
    maxReconnectDelay: 60000,
  },
};

// Validate required config
if (!config.adminToken) {
  console.warn('WARNING: ADMIN_TOKEN not set. API registration will be disabled.');
}
