import { randomUUID } from 'node:crypto';

import type {
  VendorAdapter,
  VendorCatalogEntry,
  VendorCredentials,
  VendorSubscription,
} from './types';
import { VendorError } from './types';

// ---------------------------------------------------------------------------
// DIRECT vendor adapter
//
// The DIRECT vendor type represents organisations that manage vendor
// relationships themselves — there is no external distributor API to call.
// All operations are either no-ops or produce locally-generated data so that
// the adapter satisfies the VendorAdapter contract without network calls.
//
// Credentials are accepted (and ignored) to keep the interface uniform, but
// they are never logged, stored in plain text, or returned in responses (§4.3).
// ---------------------------------------------------------------------------

export const directAdapter: VendorAdapter = {
  vendorType: 'DIRECT',

  // -------------------------------------------------------------------------
  // getSubscriptions — no external system to query
  // -------------------------------------------------------------------------
  async getSubscriptions(_credentials: VendorCredentials): Promise<VendorSubscription[]> {
    // DIRECT subscriptions are managed internally; nothing to fetch.
    return [];
  },

  // -------------------------------------------------------------------------
  // setQuantity — quantity changes are tracked internally only
  // -------------------------------------------------------------------------
  async setQuantity(
    _credentials: VendorCredentials,
    _externalSubscriptionId: string,
    quantity: number,
  ): Promise<void> {
    if (quantity < 0) {
      throw new VendorError('DIRECT', null, 'Quantity must be non-negative');
    }
    // No-op: DIRECT vendor quantities are tracked within Tally only.
  },

  // -------------------------------------------------------------------------
  // getProductCatalog — catalog is managed manually
  // -------------------------------------------------------------------------
  async getProductCatalog(_credentials: VendorCredentials): Promise<VendorCatalogEntry[]> {
    // DIRECT product catalog is maintained in Tally; nothing to fetch.
    return [];
  },

  // -------------------------------------------------------------------------
  // createSubscription — generate a local subscription record
  // -------------------------------------------------------------------------
  async createSubscription(
    _credentials: VendorCredentials,
    externalSku: string,
    quantity: number,
  ): Promise<VendorSubscription> {
    if (!externalSku) {
      throw new VendorError('DIRECT', null, 'externalSku is required to create a subscription');
    }

    if (quantity < 1) {
      throw new VendorError('DIRECT', null, 'Quantity must be at least 1');
    }

    return {
      externalId: randomUUID(),
      status: 'Active',
      quantity,
    };
  },

  // -------------------------------------------------------------------------
  // cancelSubscription — cancellation is tracked internally only
  // -------------------------------------------------------------------------
  async cancelSubscription(
    _credentials: VendorCredentials,
    _externalSubscriptionId: string,
  ): Promise<void> {
    // No-op: DIRECT vendor cancellations are tracked within Tally only.
  },
};
