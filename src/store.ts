import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { nip19 } from 'nostr-tools';
import { config } from './config.js';
import { logger } from './logger.js';
import type { Merchant } from './types.js';
import { MerchantSchema } from './types.js';

// In-memory merchant store
const merchants = new Map<string, Merchant>();

/**
 * Convert npub to hex pubkey if needed
 */
function normalizePublicKey(pubkey: string): string {
  if (pubkey.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(pubkey);
      if (decoded.type === 'npub') {
        return decoded.data;
      }
    } catch {
      throw new Error(`Invalid npub: ${pubkey}`);
    }
  }
  // Validate hex format
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new Error(`Invalid pubkey format: ${pubkey}`);
  }
  return pubkey.toLowerCase();
}

/**
 * Load merchants from config file
 */
export async function loadMerchantsFromFile(): Promise<void> {
  if (!existsSync(config.merchantsFile)) {
    logger.info('No merchants file found, starting with empty store');
    return;
  }
  
  try {
    const data = await readFile(config.merchantsFile, 'utf-8');
    const parsed = JSON.parse(data);
    
    if (!parsed.merchants || !Array.isArray(parsed.merchants)) {
      logger.warn('Invalid merchants file format');
      return;
    }
    
    for (const m of parsed.merchants) {
      try {
        const merchant = MerchantSchema.parse({
          ...m,
          pubkey: normalizePublicKey(m.pubkey),
          createdAt: m.createdAt || Date.now(),
        });
        merchants.set(merchant.pubkey, merchant);
      } catch (err) {
        logger.warn({ err, pubkey: m.pubkey }, 'Failed to parse merchant');
      }
    }
    
    logger.info(`Loaded ${merchants.size} merchants from file`);
  } catch (err) {
    logger.error({ err }, 'Failed to load merchants file');
  }
}

/**
 * Save merchants to config file
 */
async function saveMerchantsToFile(): Promise<void> {
  const data = {
    merchants: Array.from(merchants.values()),
  };
  
  try {
    await writeFile(config.merchantsFile, JSON.stringify(data, null, 2));
    logger.debug('Saved merchants to file');
  } catch (err) {
    logger.error({ err }, 'Failed to save merchants file');
  }
}

/**
 * Register a new merchant
 */
export async function registerMerchant(
  pubkey: string,
  webhookUrl: string,
  webhookSecret: string
): Promise<Merchant> {
  const normalizedPubkey = normalizePublicKey(pubkey);
  
  const merchant: Merchant = {
    pubkey: normalizedPubkey,
    webhookUrl,
    webhookSecret,
    enabled: true,
    createdAt: Date.now(),
  };
  
  merchants.set(normalizedPubkey, merchant);
  await saveMerchantsToFile();
  
  logger.info({ pubkey: normalizedPubkey.slice(0, 16) + '...' }, 'Registered merchant');
  
  return merchant;
}

/**
 * Remove a merchant
 */
export async function removeMerchant(pubkey: string): Promise<boolean> {
  const normalizedPubkey = normalizePublicKey(pubkey);
  const deleted = merchants.delete(normalizedPubkey);
  
  if (deleted) {
    await saveMerchantsToFile();
    logger.info({ pubkey: normalizedPubkey.slice(0, 16) + '...' }, 'Removed merchant');
  }
  
  return deleted;
}

/**
 * Get merchant by pubkey
 */
export function getMerchant(pubkey: string): Merchant | undefined {
  return merchants.get(pubkey.toLowerCase());
}

/**
 * Get all registered merchant pubkeys
 */
export function getAllMerchantPubkeys(): string[] {
  return Array.from(merchants.keys()).filter(pk => {
    const m = merchants.get(pk);
    return m?.enabled;
  });
}

/**
 * Get all merchants (for API)
 */
export function getAllMerchants(): Omit<Merchant, 'webhookSecret'>[] {
  return Array.from(merchants.values()).map(m => ({
    pubkey: m.pubkey,
    webhookUrl: m.webhookUrl,
    enabled: m.enabled,
    createdAt: m.createdAt,
  }));
}

/**
 * Get merchant count
 */
export function getMerchantCount(): number {
  return merchants.size;
}
