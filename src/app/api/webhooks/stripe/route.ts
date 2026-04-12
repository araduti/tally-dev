/**
 * POST /api/webhooks/stripe
 *
 * Receives and processes Stripe webhook events. This is a raw Next.js route
 * handler that bypasses tRPC — Stripe sends events server-to-server and
 * there is no user session context.
 *
 * Security:
 *   - Validates the `stripe-signature` header against STRIPE_WEBHOOK_SECRET
 *   - Never logs sensitive payment data (card numbers, etc.)
 *   - Uses the global Prisma client directly (no RLS — this is a system-level
 *     webhook that operates on data identified by metadata, not user session)
 *
 * Handled event types:
 *   - checkout.session.completed  → marks PurchaseTransaction as COMPLETED
 *   - checkout.session.expired    → marks PurchaseTransaction as FAILED
 *   - invoice.payment_succeeded   → logs successful payment
 *   - invoice.payment_failed      → logs failed payment
 */

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { constructWebhookEvent } from '@/lib/stripe';
import { prisma } from '@/lib/db';
import { writeAuditLog } from '@/lib/audit';
import { logger } from '@/lib/logger';

// Prevent Next.js from pre-rendering this route at build time
export const dynamic = 'force-dynamic';

/**
 * Stripe sends the raw body — we must NOT parse it as JSON before
 * verifying the signature.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    logger.warn('Stripe webhook received without signature header');
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 },
    );
  }

  // Read the raw body for signature verification
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(body, signature);
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Webhook signature verification failed' },
      { status: 400 },
    );
  }

  // Log the event type — never log the full payload (may contain PII)
  logger.info('Stripe webhook event received', {
    eventId: event.id,
    eventType: event.type,
  });

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event);
        break;

      case 'checkout.session.expired':
        await handleCheckoutSessionExpired(event);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event);
        break;

      default:
        // Acknowledge unhandled events without processing
        logger.debug('Unhandled Stripe event type', { eventType: event.type });
        return NextResponse.json({ received: true }, { status: 200 });
    }
  } catch (err) {
    logger.error('Stripe webhook handler failed', {
      eventId: event.id,
      eventType: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    // Return 500 so Stripe will retry the event
    return NextResponse.json(
      { error: 'Internal handler error' },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

// ── Event Handlers ─────────────────────────────────────────────────────

/**
 * checkout.session.completed — The customer has successfully paid.
 * Marks the linked PurchaseTransaction as COMPLETED.
 */
async function handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const transactionId = session.metadata?.transactionId;
  const organizationId = session.metadata?.organizationId;

  if (!transactionId || !organizationId) {
    logger.warn('checkout.session.completed missing Tally metadata', {
      eventId: event.id,
      hasTransactionId: !!transactionId,
      hasOrganizationId: !!organizationId,
    });
    return;
  }

  const transaction = await prisma.purchaseTransaction.findUnique({
    where: { id: transactionId },
  });

  if (!transaction) {
    logger.warn('checkout.session.completed: PurchaseTransaction not found', {
      transactionId,
      eventId: event.id,
    });
    return;
  }

  // Only transition from PENDING to COMPLETED
  if (transaction.status !== 'PENDING') {
    logger.info('checkout.session.completed: transaction already processed', {
      transactionId,
      currentStatus: transaction.status,
    });
    return;
  }

  await prisma.purchaseTransaction.update({
    where: { id: transactionId },
    data: {
      status: 'COMPLETED',
      distributorReference: session.payment_intent
        ? String(session.payment_intent)
        : null,
    },
  });

  await writeAuditLog({
    db: prisma,
    organizationId,
    userId: null, // System-initiated (webhook)
    action: 'billing.checkout_completed',
    entityId: transactionId,
    before: { status: transaction.status },
    after: {
      status: 'COMPLETED',
      stripeSessionId: session.id,
      stripePaymentIntent: session.payment_intent
        ? String(session.payment_intent)
        : null,
    },
  });

  logger.info('PurchaseTransaction marked as COMPLETED', {
    transactionId,
    organizationId,
  });
}

/**
 * checkout.session.expired — The checkout session timed out without payment.
 * Marks the linked PurchaseTransaction as FAILED.
 */
async function handleCheckoutSessionExpired(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const transactionId = session.metadata?.transactionId;
  const organizationId = session.metadata?.organizationId;

  if (!transactionId || !organizationId) {
    logger.warn('checkout.session.expired missing Tally metadata', {
      eventId: event.id,
      hasTransactionId: !!transactionId,
      hasOrganizationId: !!organizationId,
    });
    return;
  }

  const transaction = await prisma.purchaseTransaction.findUnique({
    where: { id: transactionId },
  });

  if (!transaction) {
    logger.warn('checkout.session.expired: PurchaseTransaction not found', {
      transactionId,
      eventId: event.id,
    });
    return;
  }

  // Only transition from PENDING to FAILED
  if (transaction.status !== 'PENDING') {
    logger.info('checkout.session.expired: transaction already processed', {
      transactionId,
      currentStatus: transaction.status,
    });
    return;
  }

  await prisma.purchaseTransaction.update({
    where: { id: transactionId },
    data: { status: 'FAILED' },
  });

  await writeAuditLog({
    db: prisma,
    organizationId,
    userId: null, // System-initiated (webhook)
    action: 'billing.checkout_expired',
    entityId: transactionId,
    before: { status: transaction.status },
    after: {
      status: 'FAILED',
      stripeSessionId: session.id,
    },
  });

  logger.info('PurchaseTransaction marked as FAILED (checkout expired)', {
    transactionId,
    organizationId,
  });
}

/**
 * invoice.payment_succeeded — A recurring invoice was paid.
 * Logged for audit trail; no transaction state change required.
 */
async function handleInvoicePaymentSucceeded(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const organizationId = invoice.metadata?.organizationId;

  logger.info('Stripe invoice payment succeeded', {
    invoiceId: invoice.id,
    organizationId: organizationId ?? 'unknown',
    // Log the amount in the smallest currency unit — safe, non-sensitive
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
  });

  if (organizationId) {
    await writeAuditLog({
      db: prisma,
      organizationId,
      userId: null,
      action: 'billing.invoice_payment_succeeded',
      entityId: invoice.id,
      after: {
        amountPaid: invoice.amount_paid,
        currency: invoice.currency,
      },
    });
  }
}

/**
 * invoice.payment_failed — A recurring invoice payment attempt failed.
 * Logged for alerting and audit trail.
 */
async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const organizationId = invoice.metadata?.organizationId;

  logger.error('Stripe invoice payment failed', {
    invoiceId: invoice.id,
    organizationId: organizationId ?? 'unknown',
    amountDue: invoice.amount_due,
    currency: invoice.currency,
    attemptCount: invoice.attempt_count,
  });

  if (organizationId) {
    await writeAuditLog({
      db: prisma,
      organizationId,
      userId: null,
      action: 'billing.invoice_payment_failed',
      entityId: invoice.id,
      after: {
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        attemptCount: invoice.attempt_count,
      },
    });
  }
}
