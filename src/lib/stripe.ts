/**
 * Stripe client and helpers for the Tally application.
 *
 * Provides a lazily-initialized Stripe SDK client and convenience wrappers
 * for creating Checkout Sessions and validating webhook signatures.
 *
 * Gracefully no-ops when STRIPE_SECRET_KEY is not configured (development),
 * following the same optional-SDK pattern as src/lib/sentry.ts.
 *
 * Usage:
 *   import { getStripeClient, createCheckoutSession, constructWebhookEvent } from '@/lib/stripe';
 *
 *   const stripe = getStripeClient();
 *   if (!stripe) { /* Stripe not configured – skip */ }
 */

import Stripe from 'stripe';
import { logger } from '@/lib/logger';

// ── Module-level state ─────────────────────────────────────────────────

let stripeClient: Stripe | null = null;
let initialized = false;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns the lazily-created Stripe client, or `null` when the
 * STRIPE_SECRET_KEY environment variable is not set.
 *
 * The client is created once and cached for the lifetime of the process.
 */
export function getStripeClient(): Stripe | null {
  if (initialized) return stripeClient;
  initialized = true;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    logger.info('Stripe secret key not configured — payment processing disabled');
    return null;
  }

  stripeClient = new Stripe(secretKey, {
    // Pin to a specific API version for deterministic behavior
    apiVersion: '2025-04-30.basil',
    typescript: true,
    appInfo: {
      name: 'Tally',
      version: process.env.npm_package_version ?? '0.0.0',
    },
  });

  logger.info('Stripe client initialized');
  return stripeClient;
}

// ── Checkout Session ───────────────────────────────────────────────────

export interface CheckoutLineItem {
  /** Human-readable name shown in Stripe Checkout */
  name: string;
  /** Unit amount in the smallest currency unit (e.g. cents for USD) */
  unitAmountCents: number;
  /** Number of units */
  quantity: number;
  /** ISO 4217 currency code, lowercase (e.g. "usd") */
  currency: string;
}

export interface CreateCheckoutSessionParams {
  /** Tally organization ID — stored in Stripe metadata for webhook correlation */
  organizationId: string;
  /** Tally PurchaseTransaction ID — stored in Stripe metadata */
  transactionId: string;
  /** Line items to display in the Stripe Checkout UI */
  lineItems: CheckoutLineItem[];
  /** URL the customer is redirected to after successful payment */
  successUrl: string;
  /** URL the customer is redirected to if they cancel */
  cancelUrl: string;
}

/**
 * Creates a Stripe Checkout Session with Tally metadata attached.
 *
 * @throws {Error} when the Stripe client is not initialized
 * @returns The created Checkout Session
 */
export async function createCheckoutSession(
  params: CreateCheckoutSessionParams,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('Stripe is not configured — cannot create checkout session');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: params.lineItems.map((item) => ({
      price_data: {
        currency: item.currency,
        product_data: { name: item.name },
        unit_amount: item.unitAmountCents,
      },
      quantity: item.quantity,
    })),
    metadata: {
      organizationId: params.organizationId,
      transactionId: params.transactionId,
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    // Session expires after 30 minutes (Stripe default is 24h — we tighten it)
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });

  logger.info('Stripe Checkout Session created', {
    sessionId: session.id,
    organizationId: params.organizationId,
    transactionId: params.transactionId,
  });

  return session;
}

// ── Webhook Signature Verification ─────────────────────────────────────

/**
 * Validates the Stripe webhook signature and parses the event payload.
 *
 * @param body  - Raw request body as a string (NOT parsed JSON)
 * @param signature - Value of the `stripe-signature` header
 * @returns The verified Stripe event
 * @throws {Stripe.errors.StripeSignatureVerificationError} on invalid signature
 */
export function constructWebhookEvent(
  body: string,
  signature: string,
): Stripe.Event {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('Stripe is not configured — cannot verify webhook');
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }

  return stripe.webhooks.constructEvent(body, signature, webhookSecret);
}
