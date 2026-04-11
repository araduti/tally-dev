import type { VendorType } from '@prisma/client';
import type { VendorAdapter, VendorCredentials } from './types';
import { decrypt } from '@/lib/encryption';
import { VendorError } from './types';
import { pax8Adapter } from './pax8';
import { ingramAdapter } from './ingram';
import { tdSynnexAdapter } from './tdsynnex';
import { directAdapter } from './direct';

// Adapter registry — add new adapters here.
// Uses Record<VendorType, …> (not Partial) so the compiler enforces that
// every VendorType enum value has a registered adapter at compile time.
const adapters: Record<VendorType, VendorAdapter> = {
  PAX8: pax8Adapter,
  INGRAM: ingramAdapter,
  TDSYNNEX: tdSynnexAdapter,
  DIRECT: directAdapter,
} satisfies Record<VendorType, VendorAdapter>;

/**
 * Returns the adapter for the given vendor type.
 * Because the registry is a full Record<VendorType, VendorAdapter>, this
 * is guaranteed at compile time to return a valid adapter for any VendorType.
 */
export function getAdapter(vendorType: VendorType): VendorAdapter {
  return adapters[vendorType];
}

/**
 * Decrypts vendor connection credentials.
 * Must only be called within an adapter — never expose decrypted credentials.
 */
export function decryptCredentials(encryptedCredentials: string): VendorCredentials {
  const decrypted = decrypt(encryptedCredentials);
  return JSON.parse(decrypted);
}
