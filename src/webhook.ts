import { createHmac } from 'crypto';
import { config } from './config.js';
import { logger } from './logger.js';
import type { Merchant, NostrEvent, WebhookPayload } from './types.js';

// Stats tracking
let eventsForwarded = 0;
let eventsFailed = 0;

export function getWebhookStats() {
  return { eventsForwarded, eventsFailed };
}

/**
 * Create HMAC signature for webhook payload
 */
function signPayload(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Deliver webhook to merchant with retries
 */
export async function deliverWebhook(
  merchant: Merchant,
  event: NostrEvent,
  relay: string
): Promise<boolean> {
  if (!merchant.webhookUrl || !merchant.webhookSecret) {
    logger.warn({ eventId: event.id.slice(0, 16) }, 'Merchant missing webhook config');
    return false;
  }
  
  const payload: WebhookPayload = {
    event,
    relay,
    receivedAt: Date.now(),
  };
  
  const body = JSON.stringify(payload);
  const signature = signPayload(body, merchant.webhookSecret);
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= config.webhook.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.webhook.timeout);
      
      const response = await fetch(merchant.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Nostr-Event-Id': event.id,
          'User-Agent': 'nostr-order-listener/0.1.0',
        },
        body,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        eventsForwarded++;
        logger.info({
          eventId: event.id.slice(0, 16) + '...',
          merchant: merchant.pubkey.slice(0, 16) + '...',
          status: response.status,
        }, 'Webhook delivered');
        return true;
      }
      
      // Non-retryable status codes
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        logger.warn({
          eventId: event.id.slice(0, 16) + '...',
          merchant: merchant.pubkey.slice(0, 16) + '...',
          status: response.status,
        }, 'Webhook rejected (non-retryable)');
        eventsFailed++;
        return false;
      }
      
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      if (lastError.name === 'AbortError') {
        lastError = new Error('Timeout');
      }
    }
    
    // Log retry attempt
    if (attempt < config.webhook.maxRetries) {
      const delay = config.webhook.retryDelay * Math.pow(2, attempt - 1);
      logger.warn({
        eventId: event.id.slice(0, 16) + '...',
        attempt,
        maxRetries: config.webhook.maxRetries,
        error: lastError?.message,
        nextRetryMs: delay,
      }, 'Webhook delivery failed, retrying');
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // All retries exhausted
  eventsFailed++;
  logger.error({
    eventId: event.id.slice(0, 16) + '...',
    merchant: merchant.pubkey.slice(0, 16) + '...',
    error: lastError?.message,
  }, 'Webhook delivery failed (all retries exhausted)');
  
  return false;
}
