import type { VendorType } from '@prisma/client';
import type { VendorAdapter, VendorCredentials } from './types';
import { decrypt } from '@/lib/encryption';
import { VendorError } from './types';
import { pax8Adapter } from './pax8';
import { ingramAdapter } from './ingram';

// Adapter registry — add new adapters here
const adapters: Partial<Record<VendorType, VendorAdapter>> = {
  PAX8: pax8Adapter,
  INGRAM: ingramAdapter,
  // TDSYNNEX: tdSynnexAdapter,
};

/**
 * Returns the adapter for the given vendor type.
 * Throws if no adapter is registered.
 */
export function getAdapter(vendorType: VendorType): VendorAdapter {
  const adapter = adapters[vendorType];
  if (!adapter) {
    throw new VendorError(vendorType, null, `No adapter registered for vendor type: ${vendorType}`);
  }
  return adapter;
}

/**
 * Decrypts vendor connection credentials.
 * Must only be called within an adapter — never expose decrypted credentials.
 */
export function decryptCredentials(encryptedCredentials: string): VendorCredentials {
  const decrypted = decrypt(encryptedCredentials);
  return JSON.parse(decrypted);
}
