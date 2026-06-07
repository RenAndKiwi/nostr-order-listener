import { nip04 } from 'nostr-tools';
import { logger } from './logger.js';

export async function decryptNip04(
  ciphertext: string,
  privateKeyHex: string,
  senderPubkeyHex: string,
): Promise<string | null> {
  try {
    const decrypted = await nip04.decrypt(privateKeyHex, senderPubkeyHex, ciphertext);
    return decrypted;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'NIP-04 decryption failed');
    return null;
  }
}
