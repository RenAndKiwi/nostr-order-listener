import { config } from './config.js';
import { logger } from './logger.js';
import { loadMerchantsFromFile, getMerchantCount } from './store.js';
import { connectToRelays, disconnectFromRelays } from './relay.js';
import { startServer } from './api.js';

async function main() {
  logger.info('Starting nostr-order-listener');
  logger.info({ relays: config.relays }, 'Configured relays');
  
  // Load merchants from file
  await loadMerchantsFromFile();
  logger.info({ count: getMerchantCount() }, 'Merchants loaded');
  
  // Start API server
  await startServer();
  
  // Connect to relays
  connectToRelays();
  
  logger.info('nostr-order-listener is running');
}

// Graceful shutdown
function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  disconnectFromRelays();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});

// Run
main().catch((err) => {
  logger.error({ err }, 'Failed to start');
  process.exit(1);
});
