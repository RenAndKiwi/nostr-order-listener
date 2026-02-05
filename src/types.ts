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

// BTCPay configuration
export const BTCPayConfigSchema = z.object({
  url: z.string().url(),
  storeId: z.string().min(1),
  apiKey: z.string().min(1),
});

export type BTCPayConfigType = z.infer<typeof BTCPayConfigSchema>;

// Merchant registration - either webhook OR btcpay config
export const MerchantSchema = z.object({
  pubkey: z.string().min(64).max(64), // hex pubkey
  name: z.string().optional(),
  // Webhook mode (optional)
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().min(16).optional(),
  // BTCPay mode (optional)
  btcpay: BTCPayConfigSchema.optional(),
  enabled: z.boolean().default(true),
  createdAt: z.number().optional(),
}).refine(
  (data) => data.webhookUrl || data.btcpay,
  { message: 'Either webhookUrl or btcpay config is required' }
);

export type Merchant = z.infer<typeof MerchantSchema>;

// Webhook payload sent to external endpoint
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
  name: z.string().optional(),
  // Webhook mode (optional)
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().min(16).optional(),
  // BTCPay mode (optional)
  btcpay: BTCPayConfigSchema.optional(),
}).refine(
  (data) => data.webhookUrl || data.btcpay,
  { message: 'Either webhookUrl or btcpay config is required' }
);

export type RegisterMerchantRequest = z.infer<typeof RegisterMerchantSchema>;
