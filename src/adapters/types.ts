import type { VendorType } from '@prisma/client';

export interface VendorCredentials {
  [key: string]: string;
}

export interface VendorSubscription {
  externalId: string;
  status: string;
  quantity: number;
  commitmentEndDate?: Date;
}

export interface VendorCatalogEntry {
  externalSku: string;
  name: string;
  unitCost: string; // Decimal as string
  currency: string;
  availability: string;
  minQuantity?: number;
  maxQuantity?: number;
}

export interface VendorMutationOptions {
  /** Idempotency key to prevent duplicate operations at the vendor */
  idempotencyKey?: string;
}

export interface VendorAdapter {
  readonly vendorType: VendorType;

  /** Fetches all subscriptions from the vendor */
  getSubscriptions(credentials: VendorCredentials): Promise<VendorSubscription[]>;

  /** Updates the seat quantity for a subscription */
  setQuantity(
    credentials: VendorCredentials,
    externalSubscriptionId: string,
    quantity: number,
    options?: VendorMutationOptions,
  ): Promise<void>;

  /** Fetches the full product catalog from the vendor */
  getProductCatalog(credentials: VendorCredentials): Promise<VendorCatalogEntry[]>;

  /** Creates a new subscription on the vendor */
  createSubscription(
    credentials: VendorCredentials,
    externalSku: string,
    quantity: number,
    options?: VendorMutationOptions,
  ): Promise<VendorSubscription>;

  /** Cancels a subscription on the vendor */
  cancelSubscription(
    credentials: VendorCredentials,
    externalSubscriptionId: string,
    options?: VendorMutationOptions,
  ): Promise<void>;
}

export class VendorError extends Error {
  constructor(
    public readonly vendorType: VendorType,
    public readonly originalError: unknown,
    message?: string,
  ) {
    super(message ?? `Vendor API error from ${vendorType}`);
    this.name = 'VendorError';
  }
}
