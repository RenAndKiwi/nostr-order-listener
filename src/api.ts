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
    
    const merchant = await registerMerchant(
      data.pubkey,
      data.webhookUrl,
      data.webhookSecret
    );
    
    // Refresh relay subscriptions to include new merchant
    refreshSubscriptions();
    
    logger.info({ pubkey: merchant.pubkey.slice(0, 16) + '...' }, 'Merchant registered via API');
    
    return {
      success: true,
      merchant: {
        pubkey: merchant.pubkey,
        webhookUrl: merchant.webhookUrl,
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
