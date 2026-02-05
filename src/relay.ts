import WebSocket from 'ws';
import { config } from './config.js';
import { logger } from './logger.js';
import { getAllMerchantPubkeys, getMerchant } from './store.js';
import { deliverWebhook } from './webhook.js';
import type { NostrEvent } from './types.js';

// Track relay connections
const relayConnections = new Map<string, WebSocket>();
const relayStatus = new Map<string, 'connected' | 'disconnected' | 'connecting'>();
let eventsReceived = 0;

// Subscription ID
const SUBSCRIPTION_ID = 'nol-' + Math.random().toString(36).slice(2, 10);

export function getRelayStats() {
  return {
    eventsReceived,
    relayConnections: Object.fromEntries(relayStatus),
  };
}

/**
 * Parse Nostr relay message
 */
function parseRelayMessage(data: string): { type: string; subId?: string; event?: NostrEvent } | null {
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.length < 2) return null;
    
    const [type, ...rest] = parsed;
    
    if (type === 'EVENT' && rest.length >= 2) {
      return { type, subId: rest[0], event: rest[1] };
    }
    
    if (type === 'EOSE') {
      return { type, subId: rest[0] };
    }
    
    if (type === 'NOTICE') {
      return { type };
    }
    
    return { type };
  } catch {
    return null;
  }
}

/**
 * Handle incoming event from relay
 */
async function handleEvent(event: NostrEvent, relay: string): Promise<void> {
  eventsReceived++;
  
  // Only process kind:4 (DMs)
  if (event.kind !== 4) {
    logger.debug({ kind: event.kind, eventId: event.id.slice(0, 16) }, 'Ignoring non-DM event');
    return;
  }
  
  // Find the merchant this DM is addressed to
  const pTags = event.tags.filter(t => t[0] === 'p').map(t => t[1]);
  
  for (const recipientPubkey of pTags) {
    const merchant = getMerchant(recipientPubkey);
    
    if (merchant && merchant.enabled) {
      logger.debug({
        eventId: event.id.slice(0, 16) + '...',
        from: event.pubkey.slice(0, 16) + '...',
        to: recipientPubkey.slice(0, 16) + '...',
      }, 'Forwarding DM to merchant');
      
      // Fire and forget - don't block relay processing
      deliverWebhook(merchant, event, relay).catch(err => {
        logger.error({ err, eventId: event.id.slice(0, 16) }, 'Webhook delivery error');
      });
      
      return; // Only deliver once even if multiple p tags match
    }
  }
  
  // No matching merchant
  logger.debug({
    eventId: event.id.slice(0, 16) + '...',
    pTags: pTags.map(p => p.slice(0, 16) + '...'),
  }, 'DM not addressed to any registered merchant');
}

/**
 * Send subscription request to relay
 */
function sendSubscription(ws: WebSocket): void {
  const pubkeys = getAllMerchantPubkeys();
  
  if (pubkeys.length === 0) {
    logger.warn('No merchants registered, subscription will match nothing');
  }
  
  // Subscribe to kind:4 where #p matches any registered merchant
  const filter = {
    kinds: [4],
    '#p': pubkeys,
  };
  
  const req = ['REQ', SUBSCRIPTION_ID, filter];
  ws.send(JSON.stringify(req));
  
  logger.info({
    subscriptionId: SUBSCRIPTION_ID,
    merchantCount: pubkeys.length,
  }, 'Sent subscription request');
}

/**
 * Connect to a single relay
 */
function connectToRelay(url: string): void {
  if (relayConnections.has(url)) {
    const existing = relayConnections.get(url);
    if (existing?.readyState === WebSocket.OPEN) {
      return;
    }
  }
  
  relayStatus.set(url, 'connecting');
  logger.info({ relay: url }, 'Connecting to relay');
  
  const ws = new WebSocket(url);
  let reconnectDelay = config.relay.reconnectDelay;
  
  ws.on('open', () => {
    relayStatus.set(url, 'connected');
    logger.info({ relay: url }, 'Connected to relay');
    reconnectDelay = config.relay.reconnectDelay; // Reset on successful connect
    sendSubscription(ws);
  });
  
  ws.on('message', async (data) => {
    const message = parseRelayMessage(data.toString());
    
    if (!message) return;
    
    if (message.type === 'EVENT' && message.event) {
      await handleEvent(message.event, url);
    } else if (message.type === 'EOSE') {
      logger.debug({ relay: url, subId: message.subId }, 'End of stored events');
    } else if (message.type === 'NOTICE') {
      logger.debug({ relay: url }, 'Relay notice received');
    }
  });
  
  ws.on('error', (err) => {
    logger.error({ relay: url, error: err.message }, 'Relay connection error');
  });
  
  ws.on('close', () => {
    relayStatus.set(url, 'disconnected');
    relayConnections.delete(url);
    logger.warn({ relay: url, reconnectMs: reconnectDelay }, 'Relay disconnected, will reconnect');
    
    // Reconnect with exponential backoff
    setTimeout(() => {
      connectToRelay(url);
    }, reconnectDelay);
    
    reconnectDelay = Math.min(reconnectDelay * 2, config.relay.maxReconnectDelay);
  });
  
  relayConnections.set(url, ws);
}

/**
 * Refresh subscriptions (call after merchant changes)
 */
export function refreshSubscriptions(): void {
  for (const [url, ws] of relayConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      // Close old subscription
      ws.send(JSON.stringify(['CLOSE', SUBSCRIPTION_ID]));
      // Send new subscription
      sendSubscription(ws);
    }
  }
}

/**
 * Connect to all configured relays
 */
export function connectToRelays(): void {
  logger.info({ relays: config.relays }, 'Connecting to relays');
  
  for (const relay of config.relays) {
    connectToRelay(relay);
  }
}

/**
 * Disconnect from all relays
 */
export function disconnectFromRelays(): void {
  for (const [url, ws] of relayConnections) {
    logger.info({ relay: url }, 'Disconnecting from relay');
    ws.close();
  }
  relayConnections.clear();
}
