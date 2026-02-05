import { z } from 'zod';

// Nostr event structure
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// Merchant registration
export const MerchantSchema = z.object({
  pubkey: z.string().min(64).max(64), // hex pubkey
  webhookUrl: z.string().url(),
  webhookSecret: z.string().min(16),
  enabled: z.boolean().default(true),
  createdAt: z.number().optional(),
});

export type Merchant = z.infer<typeof MerchantSchema>;

// Webhook payload sent to WordPress
export interface WebhookPayload {
  event: NostrEvent;
  relay: string;
  receivedAt: number;
}

// Stats
export interface Stats {
  uptime: number;
  merchants: number;
  eventsReceived: number;
  eventsForwarded: number;
  eventsFailed: number;
  relayConnections: Record<string, 'connected' | 'disconnected' | 'connecting'>;
}

// Merchant registration request
export const RegisterMerchantSchema = z.object({
  pubkey: z.string().min(1), // Can be npub or hex
  webhookUrl: z.string().url(),
  webhookSecret: z.string().min(16),
});

export type RegisterMerchantRequest = z.infer<typeof RegisterMerchantSchema>;
