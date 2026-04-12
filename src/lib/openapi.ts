/**
 * OpenAPI 3.1.0 Specification for Tally's tRPC API.
 *
 * Maps each tRPC procedure to a POST endpoint following tRPC's HTTP batch
 * pattern.  Serves as a machine-readable contract for external consumers.
 *
 * @see LEFT.md item #49 — "No OpenAPI / Swagger Documentation"
 */

// ---------------------------------------------------------------------------
// Shared schema components ($ref targets)
// ---------------------------------------------------------------------------

const cursorPaginationInput = {
  type: 'object' as const,
  properties: {
    cursor: {
      type: 'string',
      description: 'Opaque cursor returned by the previous page.',
      nullable: true,
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 25,
      description: 'Number of items per page.',
    },
  },
};

const cursorPaginationOutput = (itemRef: string) => ({
  type: 'object' as const,
  required: ['items', 'nextCursor'],
  properties: {
    items: { type: 'array', items: { $ref: `#/components/schemas/${itemRef}` } },
    nextCursor: {
      type: ['string', 'null'],
      description: 'Cursor for the next page, or null if this is the last page.',
    },
  },
});

const idempotencyKey = {
  idempotencyKey: {
    type: 'string' as const,
    format: 'uuid' as const,
    description:
      'Client-generated UUID for mutation idempotency. Duplicate keys within the validity window (24 h) return the cached response.',
  },
};

// ---------------------------------------------------------------------------
// Error response
// ---------------------------------------------------------------------------

const errorResponse = {
  type: 'object' as const,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['message', 'code'],
      properties: {
        message: { type: 'string' },
        code: {
          type: 'string',
          enum: [
            'BAD_REQUEST',
            'UNAUTHORIZED',
            'FORBIDDEN',
            'NOT_FOUND',
            'CONFLICT',
            'PRECONDITION_FAILED',
            'TOO_MANY_REQUESTS',
            'INTERNAL_SERVER_ERROR',
          ],
        },
        data: {
          type: 'object',
          description: 'Additional error metadata (e.g. Zod validation issues).',
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// tRPC envelope helpers
// ---------------------------------------------------------------------------

function trpcEnvelope(dataSchema: Record<string, unknown>) {
  return {
    type: 'object' as const,
    required: ['result'],
    properties: {
      result: {
        type: 'object',
        required: ['data'],
        properties: { data: dataSchema },
      },
    },
  };
}

function trpcPath(procedure: string): string {
  return `/api/trpc/${procedure}`;
}

function commonErrorResponses() {
  return {
    '400': { description: 'Bad Request — invalid input', content: { 'application/json': { schema: { $ref: '#/components/schemas/TRPCError' } } } },
    '401': { description: 'Unauthorized — session cookie missing or expired', content: { 'application/json': { schema: { $ref: '#/components/schemas/TRPCError' } } } },
    '403': { description: 'Forbidden — insufficient role', content: { 'application/json': { schema: { $ref: '#/components/schemas/TRPCError' } } } },
    '404': { description: 'Not Found', content: { 'application/json': { schema: { $ref: '#/components/schemas/TRPCError' } } } },
    '409': { description: 'Conflict — duplicate idempotency key', content: { 'application/json': { schema: { $ref: '#/components/schemas/TRPCError' } } } },
    '412': { description: 'Precondition Failed — commitment constraint violated', content: { 'application/json': { schema: { $ref: '#/components/schemas/TRPCError' } } } },
    '429': { description: 'Too Many Requests — rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/TRPCError' } } } },
    '500': { description: 'Internal Server Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/TRPCError' } } } },
  };
}

function makePost(
  tag: string,
  summary: string,
  operationId: string,
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown>,
  description?: string,
) {
  return {
    post: {
      tags: [tag],
      summary,
      operationId,
      ...(description ? { description } : {}),
      security: [{ cookieAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: inputSchema } },
      },
      responses: {
        '200': {
          description: 'Successful response',
          content: { 'application/json': { schema: trpcEnvelope(outputSchema) } },
        },
        ...commonErrorResponses(),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Enum values (mirrored from Prisma schema)
// ---------------------------------------------------------------------------

const VendorType = ['PAX8', 'INGRAM', 'TDSYNNEX', 'DIRECT'] as const;
const SubscriptionStatus = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED'] as const;
const TransactionStatus = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'] as const;
const VendorConnectionStatus = ['PENDING', 'ACTIVE', 'ERROR', 'DISCONNECTED'] as const;
const InvitationStatus = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED'] as const;
const BillingType = ['DIRECT_STRIPE', 'MANUAL_INVOICE'] as const;
const OrgRole = ['ORG_OWNER', 'ORG_ADMIN', 'ORG_MEMBER'] as const;
const MspRole = ['MSP_OWNER', 'MSP_ADMIN', 'MSP_TECHNICIAN'] as const;
const OrganizationType = ['MSP', 'CLIENT', 'DIRECT'] as const;
const InsightType = ['RECOMMENDATION', 'WASTE_ALERT'] as const;
const Severity = ['LOW', 'MEDIUM', 'HIGH'] as const;

// ---------------------------------------------------------------------------
// Spec builder
// ---------------------------------------------------------------------------

export function buildOpenApiSpec(): Record<string, unknown> {
  const serverUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';

  return {
    openapi: '3.1.0',
    info: {
      title: 'Tally API',
      version: '0.1.0',
      description:
        'Multi-distributor license optimization platform. ' +
        'All procedures are exposed via tRPC over HTTP POST. ' +
        'Authenticate with a session cookie obtained from Better Auth.',
      license: { name: 'Proprietary' },
    },
    servers: [{ url: serverUrl, description: 'Tally server' }],

    // -- Security ----------------------------------------------------------
    security: [{ cookieAuth: [] }],

    // -- Tags --------------------------------------------------------------
    tags: [
      { name: 'Catalog', description: 'Browse bundles and compare pricing across distributors.' },
      { name: 'Subscription', description: 'Manage subscription lifecycle.' },
      { name: 'License', description: 'Scale, import, and manage license entitlements.' },
      { name: 'Vendor', description: 'Connect and manage distributor integrations.' },
      { name: 'Billing', description: 'Payments, transactions, and invoicing.' },
      { name: 'Admin', description: 'Members, invitations, roles, and audit logs.' },
      { name: 'Organization', description: 'Organization settings, DPA, contracts, and MSP hierarchy.' },
      { name: 'Insights', description: 'AI-powered optimization recommendations and waste alerts.' },
      { name: 'User', description: 'Current user profile.' },
      { name: 'Notification', description: 'In-app notifications.' },
    ],

    // -- Paths -------------------------------------------------------------
    paths: {
      // ---- Catalog -------------------------------------------------------
      [trpcPath('catalog.listBundles')]: makePost(
        'Catalog',
        'List bundles',
        'catalog.listBundles',
        {
          type: 'object',
          properties: {
            ...cursorPaginationInput.properties,
            where: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                name: { type: 'string', description: 'Case-insensitive substring match.' },
              },
            },
            orderBy: {
              type: 'object',
              properties: {
                field: { type: 'string', enum: ['name', 'createdAt'] },
                direction: { type: 'string', enum: ['asc', 'desc'] },
              },
            },
          },
        },
        cursorPaginationOutput('Bundle'),
        'Paginated list of bundles with optional filtering and ordering. Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('catalog.getBundle')]: makePost(
        'Catalog',
        'Get a single bundle',
        'catalog.getBundle',
        {
          type: 'object',
          required: ['bundleId'],
          properties: { bundleId: { type: 'string', format: 'cuid' } },
        },
        { $ref: '#/components/schemas/BundleDetail' },
        'Returns the bundle with its products and product offerings. Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('catalog.listProductOfferings')]: makePost(
        'Catalog',
        'List product offerings',
        'catalog.listProductOfferings',
        {
          type: 'object',
          properties: {
            ...cursorPaginationInput.properties,
            where: {
              type: 'object',
              properties: {
                bundleId: { type: 'string', format: 'cuid' },
                sourceType: { type: 'string', enum: [...VendorType] },
                availability: { type: 'boolean' },
              },
            },
          },
        },
        cursorPaginationOutput('ProductOffering'),
        'Paginated list of product offerings. Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('catalog.comparePricing')]: makePost(
        'Catalog',
        'Compare pricing across distributors',
        'catalog.comparePricing',
        {
          type: 'object',
          required: ['bundleId', 'quantity'],
          properties: {
            bundleId: { type: 'string', format: 'cuid' },
            quantity: { type: 'integer', minimum: 1 },
          },
        },
        {
          type: 'object',
          properties: {
            bundleId: { type: 'string' },
            bundleName: { type: 'string' },
            quantity: { type: 'integer' },
            options: {
              type: 'array',
              items: { $ref: '#/components/schemas/PricingOption' },
            },
          },
        },
        'Returns ranked pricing options from all connected distributors. Uses Decimal.js for accuracy. Minimum role: ORG_ADMIN.',
      ),

      // ---- Subscription --------------------------------------------------
      [trpcPath('subscription.list')]: makePost(
        'Subscription',
        'List subscriptions',
        'subscription.list',
        {
          type: 'object',
          properties: {
            ...cursorPaginationInput.properties,
            where: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: [...SubscriptionStatus] },
                bundleId: { type: 'string', format: 'cuid' },
              },
            },
          },
        },
        cursorPaginationOutput('Subscription'),
        'Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('subscription.get')]: makePost(
        'Subscription',
        'Get a single subscription',
        'subscription.get',
        {
          type: 'object',
          required: ['subscriptionId'],
          properties: { subscriptionId: { type: 'string', format: 'cuid' } },
        },
        { $ref: '#/components/schemas/SubscriptionDetail' },
        'Includes bundle, licenses, and vendor connection. Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('subscription.create')]: makePost(
        'Subscription',
        'Create a subscription',
        'subscription.create',
        {
          type: 'object',
          required: ['productOfferingId', 'quantity', 'idempotencyKey'],
          properties: {
            productOfferingId: { type: 'string', format: 'cuid' },
            quantity: { type: 'integer', minimum: 1 },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            subscription: { $ref: '#/components/schemas/Subscription' },
            license: { $ref: '#/components/schemas/License' },
            purchaseTransaction: { $ref: '#/components/schemas/PurchaseTransaction' },
          },
        },
        'Provisions on the vendor before creating local records. Minimum role: ORG_ADMIN.',
      ),

      [trpcPath('subscription.cancel')]: makePost(
        'Subscription',
        'Cancel a subscription',
        'subscription.cancel',
        {
          type: 'object',
          required: ['subscriptionId', 'idempotencyKey'],
          properties: {
            subscriptionId: { type: 'string', format: 'cuid' },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            subscription: { $ref: '#/components/schemas/Subscription' },
            scheduledDate: {
              type: ['string', 'null'],
              format: 'date-time',
              description: 'If the subscription has an active commitment, cancellation is scheduled for this date.',
            },
          },
        },
        'Calls the vendor to cancel. If commitment is active, schedules cancellation. Minimum role: ORG_ADMIN.',
      ),

      // ---- License -------------------------------------------------------
      [trpcPath('license.list')]: makePost(
        'License',
        'List licenses',
        'license.list',
        {
          type: 'object',
          properties: {
            ...cursorPaginationInput.properties,
            where: {
              type: 'object',
              properties: {
                subscriptionId: { type: 'string', format: 'cuid' },
                hasPendingScaleDown: { type: 'boolean' },
              },
            },
          },
        },
        cursorPaginationOutput('License'),
        'Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('license.get')]: makePost(
        'License',
        'Get a single license',
        'license.get',
        {
          type: 'object',
          required: ['licenseId'],
          properties: { licenseId: { type: 'string', format: 'cuid' } },
        },
        { $ref: '#/components/schemas/LicenseDetail' },
        'Includes subscription and product offering. Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('license.scaleUp')]: makePost(
        'License',
        'Scale up license quantity',
        'license.scaleUp',
        {
          type: 'object',
          required: ['licenseId', 'newQuantity', 'idempotencyKey'],
          properties: {
            licenseId: { type: 'string', format: 'cuid' },
            newQuantity: { type: 'integer', minimum: 1 },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            license: { $ref: '#/components/schemas/License' },
            purchaseTransaction: { $ref: '#/components/schemas/PurchaseTransaction' },
          },
        },
        'Calls vendor adapter to increase seats. Minimum role: MSP_TECHNICIAN.',
      ),

      [trpcPath('license.scaleDown')]: makePost(
        'License',
        'Scale down license quantity',
        'license.scaleDown',
        {
          type: 'object',
          required: ['licenseId', 'newQuantity', 'idempotencyKey'],
          properties: {
            licenseId: { type: 'string', format: 'cuid' },
            newQuantity: { type: 'integer', minimum: 0 },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            license: { $ref: '#/components/schemas/License' },
            isStaged: {
              type: 'boolean',
              description: 'True if scale-down is deferred until commitment ends.',
            },
            commitmentEndDate: {
              type: ['string', 'null'],
              format: 'date-time',
              description: 'When the commitment period ends (if staged).',
            },
            inngestRunId: {
              type: ['string', 'null'],
              description: 'Background workflow run ID (if staged).',
            },
          },
        },
        'Commitment-aware: staged if within commitment window, immediate otherwise. Minimum role: MSP_TECHNICIAN.',
      ),

      [trpcPath('license.cancelPendingScaleDown')]: makePost(
        'License',
        'Cancel a pending scale-down',
        'license.cancelPendingScaleDown',
        {
          type: 'object',
          required: ['licenseId', 'idempotencyKey'],
          properties: {
            licenseId: { type: 'string', format: 'cuid' },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: { license: { $ref: '#/components/schemas/License' } },
        },
        'Resets pendingQuantity to null. Minimum role: MSP_TECHNICIAN.',
      ),

      [trpcPath('license.importLicenses')]: makePost(
        'License',
        'Bulk import licenses',
        'license.importLicenses',
        {
          type: 'object',
          required: ['records', 'idempotencyKey'],
          properties: {
            records: {
              type: 'array',
              minItems: 1,
              maxItems: 500,
              items: {
                type: 'object',
                required: ['productOfferingId', 'quantity'],
                properties: {
                  productOfferingId: { type: 'string', format: 'cuid' },
                  quantity: { type: 'integer', minimum: 1 },
                },
              },
            },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            imported: { type: 'integer' },
            skipped: { type: 'integer' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  status: { type: 'string', enum: ['SUCCESS', 'SKIPPED', 'ERROR'] },
                  licenseId: { type: ['string', 'null'] },
                  error: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
        'Creates subscriptions automatically if needed. Minimum role: ORG_ADMIN.',
      ),

      // ---- Vendor --------------------------------------------------------
      [trpcPath('vendor.listConnections')]: makePost(
        'Vendor',
        'List vendor connections',
        'vendor.listConnections',
        {
          type: 'object',
          properties: {
            ...cursorPaginationInput.properties,
            where: {
              type: 'object',
              properties: {
                vendorType: { type: 'string', enum: [...VendorType] },
                status: { type: 'string', enum: [...VendorConnectionStatus] },
              },
            },
          },
        },
        cursorPaginationOutput('VendorConnection'),
        'Credentials are never returned. Minimum role: MSP_TECHNICIAN.',
      ),

      [trpcPath('vendor.connect')]: makePost(
        'Vendor',
        'Connect a vendor',
        'vendor.connect',
        {
          type: 'object',
          required: ['vendorType', 'credentials', 'idempotencyKey'],
          properties: {
            vendorType: { type: 'string', enum: [...VendorType] },
            credentials: {
              type: 'string',
              minLength: 1,
              format: 'password',
              description: 'Encrypted vendor credentials (JSON string).',
            },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            vendorConnection: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                vendorType: { type: 'string', enum: [...VendorType] },
                status: { type: 'string', enum: [...VendorConnectionStatus] },
              },
            },
          },
        },
        'Credentials are encrypted before storage. Minimum role: ORG_OWNER.',
      ),

      [trpcPath('vendor.disconnect')]: makePost(
        'Vendor',
        'Disconnect a vendor',
        'vendor.disconnect',
        {
          type: 'object',
          required: ['vendorConnectionId', 'idempotencyKey'],
          properties: {
            vendorConnectionId: { type: 'string', format: 'cuid' },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            vendorConnection: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                status: { type: 'string', enum: [...VendorConnectionStatus] },
              },
            },
          },
        },
        'Uses two-pass cryptographic erasure. Minimum role: ORG_OWNER.',
      ),

      [trpcPath('vendor.syncCatalog')]: makePost(
        'Vendor',
        'Trigger catalog sync',
        'vendor.syncCatalog',
        {
          type: 'object',
          required: ['vendorConnectionId', 'idempotencyKey'],
          properties: {
            vendorConnectionId: { type: 'string', format: 'cuid' },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            syncId: { type: 'string' },
            status: { type: 'string', enum: ['ENQUEUED'] },
          },
        },
        'Enqueues an Inngest workflow. Minimum role: ORG_ADMIN.',
      ),

      // ---- Billing -------------------------------------------------------
      [trpcPath('billing.getPaymentStatus')]: makePost(
        'Billing',
        'Check payment configuration',
        'billing.getPaymentStatus',
        { type: 'object', properties: {} },
        {
          type: 'object',
          properties: {
            stripeEnabled: { type: 'boolean' },
            billingType: { type: 'string', enum: [...BillingType] },
          },
        },
        'Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('billing.createCheckoutSession')]: makePost(
        'Billing',
        'Create Stripe checkout session',
        'billing.createCheckoutSession',
        {
          type: 'object',
          required: ['productOfferingId', 'quantity', 'successUrl', 'cancelUrl', 'idempotencyKey'],
          properties: {
            productOfferingId: { type: 'string', format: 'cuid' },
            quantity: { type: 'integer', minimum: 1 },
            successUrl: { type: 'string', format: 'uri' },
            cancelUrl: { type: 'string', format: 'uri' },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            checkoutUrl: { type: 'string', format: 'uri' },
            transactionId: { type: 'string' },
          },
        },
        'Creates a Stripe checkout session. Minimum role: ORG_ADMIN.',
      ),

      [trpcPath('billing.listTransactions')]: makePost(
        'Billing',
        'List transactions',
        'billing.listTransactions',
        {
          type: 'object',
          properties: {
            ...cursorPaginationInput.properties,
            where: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: [...TransactionStatus] },
              },
            },
            orderBy: {
              type: 'object',
              properties: {
                field: { type: 'string', enum: ['createdAt', 'grossAmount'] },
                direction: { type: 'string', enum: ['asc', 'desc'] },
              },
            },
          },
        },
        cursorPaginationOutput('PurchaseTransaction'),
        'Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('billing.getSnapshot')]: makePost(
        'Billing',
        'Get billing snapshot',
        'billing.getSnapshot',
        {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string', format: 'cuid' },
            periodStart: { type: 'string', format: 'date-time' },
            periodEnd: { type: 'string', format: 'date-time' },
          },
        },
        { $ref: '#/components/schemas/BillingSnapshot' },
        'Minimum role: ORG_ADMIN.',
      ),

      [trpcPath('billing.projectInvoice')]: makePost(
        'Billing',
        'Project invoice',
        'billing.projectInvoice',
        {
          type: 'object',
          properties: {
            periodStart: { type: 'string', format: 'date-time' },
            periodEnd: { type: 'string', format: 'date-time' },
          },
        },
        {
          type: 'object',
          properties: {
            periodStart: { type: 'string', format: 'date-time' },
            periodEnd: { type: 'string', format: 'date-time' },
            totalProjectedAmount: { type: 'string', description: 'Decimal string for precision.' },
            lineItems: {
              type: 'array',
              items: { $ref: '#/components/schemas/InvoiceLineItem' },
            },
          },
        },
        'Projects costs for the given period. Minimum role: ORG_ADMIN.',
      ),

      [trpcPath('billing.createSnapshot')]: makePost(
        'Billing',
        'Create billing snapshot',
        'billing.createSnapshot',
        {
          type: 'object',
          required: ['idempotencyKey'],
          properties: {
            periodStart: { type: 'string', format: 'date-time' },
            periodEnd: { type: 'string', format: 'date-time' },
            ...idempotencyKey,
          },
        },
        { $ref: '#/components/schemas/BillingSnapshot' },
        'Creates a point-in-time billing snapshot. Minimum role: ORG_ADMIN.',
      ),

      // ---- Admin ---------------------------------------------------------
      [trpcPath('admin.listMembers')]: makePost(
        'Admin',
        'List organization members',
        'admin.listMembers',
        { type: 'object', properties: { ...cursorPaginationInput.properties } },
        cursorPaginationOutput('Member'),
        'Minimum role: ORG_OWNER.',
      ),

      [trpcPath('admin.inviteMember')]: makePost(
        'Admin',
        'Send invitation',
        'admin.inviteMember',
        {
          type: 'object',
          required: ['email', 'idempotencyKey'],
          properties: {
            email: { type: 'string', format: 'email' },
            orgRole: { type: 'string', enum: [...OrgRole] },
            mspRole: { type: 'string', enum: [...MspRole] },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: { invitation: { $ref: '#/components/schemas/Invitation' } },
        },
        'Exactly one of orgRole or mspRole must be provided. Minimum role: ORG_OWNER.',
      ),

      [trpcPath('admin.revokeInvitation')]: makePost(
        'Admin',
        'Revoke invitation',
        'admin.revokeInvitation',
        {
          type: 'object',
          required: ['invitationId', 'idempotencyKey'],
          properties: {
            invitationId: { type: 'string', format: 'cuid' },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            invitation: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                status: { type: 'string', enum: [...InvitationStatus] },
              },
            },
          },
        },
        'Minimum role: ORG_OWNER.',
      ),

      [trpcPath('admin.resendInvitation')]: makePost(
        'Admin',
        'Resend invitation',
        'admin.resendInvitation',
        {
          type: 'object',
          required: ['invitationId', 'idempotencyKey'],
          properties: {
            invitationId: { type: 'string', format: 'cuid' },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: { invitation: { $ref: '#/components/schemas/Invitation' } },
        },
        'Resets expiry and re-sends the email. Minimum role: ORG_OWNER.',
      ),

      [trpcPath('admin.acceptInvitation')]: makePost(
        'Admin',
        'Accept invitation',
        'admin.acceptInvitation',
        {
          type: 'object',
          required: ['invitationId', 'idempotencyKey'],
          properties: {
            invitationId: { type: 'string', format: 'cuid' },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            member: { $ref: '#/components/schemas/Member' },
            invitation: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                status: { type: 'string', enum: [...InvitationStatus] },
              },
            },
          },
        },
        'Creates a Member record and marks invitation accepted. Requires authentication only (no org context).',
      ),

      [trpcPath('admin.rejectInvitation')]: makePost(
        'Admin',
        'Reject invitation',
        'admin.rejectInvitation',
        {
          type: 'object',
          required: ['invitationId', 'idempotencyKey'],
          properties: {
            invitationId: { type: 'string', format: 'cuid' },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            invitation: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                status: { type: 'string', enum: [...InvitationStatus] },
              },
            },
          },
        },
        'Requires authentication only (no org context).',
      ),

      [trpcPath('admin.updateRole')]: makePost(
        'Admin',
        'Update member role',
        'admin.updateRole',
        {
          type: 'object',
          required: ['memberId', 'idempotencyKey'],
          properties: {
            memberId: { type: 'string', format: 'cuid' },
            orgRole: { type: 'string', enum: [...OrgRole] },
            mspRole: { type: 'string', enum: [...MspRole] },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            member: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                orgRole: { type: ['string', 'null'], enum: [...OrgRole, null] },
                mspRole: { type: ['string', 'null'], enum: [...MspRole, null] },
              },
            },
          },
        },
        'Minimum role: ORG_OWNER.',
      ),

      [trpcPath('admin.removeMember')]: makePost(
        'Admin',
        'Remove member',
        'admin.removeMember',
        {
          type: 'object',
          required: ['memberId', 'idempotencyKey'],
          properties: {
            memberId: { type: 'string', format: 'cuid' },
            ...idempotencyKey,
          },
        },
        { type: 'object', properties: { success: { type: 'boolean', const: true } } },
        'Minimum role: ORG_OWNER.',
      ),

      [trpcPath('admin.listInvitations')]: makePost(
        'Admin',
        'List invitations',
        'admin.listInvitations',
        {
          type: 'object',
          properties: {
            ...cursorPaginationInput.properties,
            where: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: [...InvitationStatus] },
              },
            },
          },
        },
        cursorPaginationOutput('Invitation'),
        'Minimum role: ORG_OWNER.',
      ),

      [trpcPath('admin.listAuditLogs')]: makePost(
        'Admin',
        'List audit logs',
        'admin.listAuditLogs',
        {
          type: 'object',
          properties: {
            ...cursorPaginationInput.properties,
            where: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                entityId: { type: 'string' },
                userId: { type: 'string' },
                entityType: { type: 'string' },
                from: { type: 'string', format: 'date-time' },
                to: { type: 'string', format: 'date-time' },
              },
            },
            orderBy: {
              type: 'object',
              properties: {
                field: { type: 'string', enum: ['createdAt'] },
                direction: { type: 'string', enum: ['asc', 'desc'] },
              },
            },
          },
        },
        cursorPaginationOutput('AuditLog'),
        'Minimum role: ORG_OWNER.',
      ),

      // ---- Organization --------------------------------------------------
      [trpcPath('organization.get')]: makePost(
        'Organization',
        'Get organization details',
        'organization.get',
        { type: 'object', properties: {} },
        { $ref: '#/components/schemas/Organization' },
        'Returns the active organization. Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('organization.update')]: makePost(
        'Organization',
        'Update organization settings',
        'organization.update',
        {
          type: 'object',
          required: ['idempotencyKey'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            logo: { type: 'string', format: 'uri' },
            billingType: { type: 'string', enum: [...BillingType] },
            metadata: {
              type: 'object',
              additionalProperties: {
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'boolean' },
                  { type: 'null' },
                ],
              },
            },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: { organization: { $ref: '#/components/schemas/Organization' } },
        },
        'Minimum role: ORG_OWNER.',
      ),

      [trpcPath('organization.createClient')]: makePost(
        'Organization',
        'Create MSP client organization',
        'organization.createClient',
        {
          type: 'object',
          required: ['name', 'slug', 'idempotencyKey'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            slug: {
              type: 'string',
              minLength: 1,
              maxLength: 100,
              pattern: '^[a-z0-9-]+$',
              description: 'URL-safe slug for the client organization.',
            },
            billingType: { type: 'string', enum: [...BillingType] },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: { organization: { $ref: '#/components/schemas/Organization' } },
        },
        'Creates a CLIENT org under the current MSP. Minimum role: MSP_ADMIN.',
      ),

      [trpcPath('organization.listClients')]: makePost(
        'Organization',
        'List client organizations',
        'organization.listClients',
        { type: 'object', properties: { ...cursorPaginationInput.properties } },
        cursorPaginationOutput('Organization'),
        'Lists CLIENT orgs managed by the current MSP. Minimum role: MSP_TECHNICIAN.',
      ),

      [trpcPath('organization.switchOrg')]: makePost(
        'Organization',
        'Switch active organization',
        'organization.switchOrg',
        {
          type: 'object',
          required: ['organizationId', 'idempotencyKey'],
          properties: {
            organizationId: { type: 'string', format: 'cuid' },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            organization: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                slug: { type: 'string' },
                organizationType: { type: 'string', enum: [...OrganizationType] },
              },
            },
          },
        },
        'Switches the session to a different organization. Requires authentication only.',
      ),

      [trpcPath('organization.deactivate')]: makePost(
        'Organization',
        'Soft-delete organization',
        'organization.deactivate',
        {
          type: 'object',
          required: ['idempotencyKey'],
          properties: { ...idempotencyKey },
        },
        {
          type: 'object',
          properties: {
            organization: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                deletedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        'Sets deletedAt timestamp. Minimum role: ORG_OWNER.',
      ),

      [trpcPath('organization.getDpaStatus')]: makePost(
        'Organization',
        'Get DPA status',
        'organization.getDpaStatus',
        { type: 'object', properties: {} },
        {
          type: 'object',
          properties: {
            accepted: { type: 'boolean' },
            requiredVersion: { type: 'string' },
            acceptedVersion: { type: ['string', 'null'] },
            isOutdated: { type: 'boolean' },
            acceptedAt: { type: ['string', 'null'], format: 'date-time' },
            acceptedBy: { type: ['string', 'null'] },
          },
        },
        'Returns Data Processing Agreement acceptance status. Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('organization.acceptDpa')]: makePost(
        'Organization',
        'Accept DPA',
        'organization.acceptDpa',
        {
          type: 'object',
          required: ['version', 'idempotencyKey'],
          properties: {
            version: { type: 'string', minLength: 1 },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            dpaAcceptance: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                version: { type: 'string' },
                acceptedAt: { type: 'string', format: 'date-time' },
                userId: { type: 'string' },
              },
            },
          },
        },
        'Records DPA acceptance. Minimum role: ORG_OWNER.',
      ),

      [trpcPath('organization.getContractStatus')]: makePost(
        'Organization',
        'Get contract status',
        'organization.getContractStatus',
        { type: 'object', properties: {} },
        {
          type: 'object',
          properties: {
            isContractSigned: { type: 'boolean' },
            provisioningEnabled: { type: 'boolean' },
          },
        },
        'Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('organization.signContract')]: makePost(
        'Organization',
        'Sign contract',
        'organization.signContract',
        {
          type: 'object',
          required: ['idempotencyKey'],
          properties: { ...idempotencyKey },
        },
        {
          type: 'object',
          properties: {
            organization: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                isContractSigned: { type: 'boolean' },
                provisioningEnabled: { type: 'boolean' },
              },
            },
          },
        },
        'Enables provisioning after contract is signed. Minimum role: ORG_OWNER.',
      ),

      [trpcPath('organization.saveOnboardingSelections')]: makePost(
        'Organization',
        'Save onboarding selections',
        'organization.saveOnboardingSelections',
        {
          type: 'object',
          required: ['selectedVendors', 'intent', 'idempotencyKey'],
          properties: {
            selectedVendors: { type: 'array', items: { type: 'string' } },
            intent: { type: 'string', enum: ['analyze', 'buy'] },
            ...idempotencyKey,
          },
        },
        { type: 'object', properties: { success: { type: 'boolean', const: true } } },
        'Saves discovery-first onboarding selections. Requires authentication only.',
      ),

      // ---- Insights ------------------------------------------------------
      [trpcPath('insights.getRecommendations')]: makePost(
        'Insights',
        'Get optimization recommendations',
        'insights.getRecommendations',
        { type: 'object', properties: {} },
        {
          type: 'object',
          properties: {
            recommendations: {
              type: 'array',
              items: { $ref: '#/components/schemas/Recommendation' },
            },
            generatedAt: { type: 'string', format: 'date-time' },
          },
        },
        'AI-powered optimization suggestions. Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('insights.getWasteAlerts')]: makePost(
        'Insights',
        'Get waste alerts',
        'insights.getWasteAlerts',
        { type: 'object', properties: {} },
        {
          type: 'object',
          properties: {
            alerts: {
              type: 'array',
              items: { $ref: '#/components/schemas/WasteAlert' },
            },
            analyzedAt: { type: 'string', format: 'date-time' },
          },
        },
        'Detects unused licenses, over-provisioning, and stale subscriptions. Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('insights.persistInsights')]: makePost(
        'Insights',
        'Save insights snapshot',
        'insights.persistInsights',
        {
          type: 'object',
          required: ['idempotencyKey'],
          properties: { ...idempotencyKey },
        },
        {
          type: 'object',
          properties: {
            snapshotCount: { type: 'integer' },
            recommendationCount: { type: 'integer' },
            wasteAlertCount: { type: 'integer' },
            generatedAt: { type: 'string', format: 'date-time' },
          },
        },
        'Persists current insights as historical snapshots. Minimum role: ORG_ADMIN.',
      ),

      [trpcPath('insights.listInsightHistory')]: makePost(
        'Insights',
        'List insight history',
        'insights.listInsightHistory',
        {
          type: 'object',
          properties: {
            ...cursorPaginationInput.properties,
            where: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: [...InsightType] },
                severity: { type: 'string', enum: [...Severity] },
                from: { type: 'string', format: 'date-time' },
                to: { type: 'string', format: 'date-time' },
                dismissed: { type: 'boolean' },
              },
            },
          },
        },
        cursorPaginationOutput('InsightSnapshot'),
        'Historical insight snapshots with optional filters. Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('insights.dismissInsight')]: makePost(
        'Insights',
        'Dismiss insight',
        'insights.dismissInsight',
        {
          type: 'object',
          required: ['snapshotId', 'idempotencyKey'],
          properties: {
            snapshotId: { type: 'string', format: 'cuid' },
            ...idempotencyKey,
          },
        },
        {
          type: 'object',
          properties: {
            snapshot: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                dismissedAt: { type: 'string', format: 'date-time' },
                dismissedByUserId: { type: 'string' },
              },
            },
          },
        },
        'Minimum role: ORG_ADMIN.',
      ),

      // ---- User ----------------------------------------------------------
      [trpcPath('user.me')]: makePost(
        'User',
        'Get current user profile',
        'user.me',
        { type: 'object', properties: {} },
        {
          oneOf: [
            {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string', format: 'email' },
                image: { type: ['string', 'null'], format: 'uri' },
              },
            },
            { type: 'null' },
          ],
        },
        'Returns the authenticated user profile, or null if not found. Requires authentication only (no org context).',
      ),

      // ---- Notification --------------------------------------------------
      [trpcPath('notification.list')]: makePost(
        'Notification',
        'List notifications',
        'notification.list',
        {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            cursor: { type: ['string', 'null'] },
          },
        },
        cursorPaginationOutput('Notification'),
        'Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('notification.unreadCount')]: makePost(
        'Notification',
        'Get unread notification count',
        'notification.unreadCount',
        { type: 'object', properties: {} },
        { type: 'object', properties: { count: { type: 'integer' } } },
        'Minimum role: ORG_MEMBER.',
      ),

      [trpcPath('notification.markAsRead')]: makePost(
        'Notification',
        'Mark notification as read',
        'notification.markAsRead',
        {
          type: 'object',
          required: ['notificationId', 'idempotencyKey'],
          properties: {
            notificationId: { type: 'string' },
            ...idempotencyKey,
          },
        },
        { $ref: '#/components/schemas/Notification' },
        'Minimum role: ORG_ADMIN.',
      ),

      [trpcPath('notification.markAllAsRead')]: makePost(
        'Notification',
        'Mark all notifications as read',
        'notification.markAllAsRead',
        {
          type: 'object',
          required: ['idempotencyKey'],
          properties: { ...idempotencyKey },
        },
        { type: 'object', properties: { count: { type: 'integer' } } },
        'Returns the number of notifications marked as read. Minimum role: ORG_ADMIN.',
      ),
    },

    // -- Components --------------------------------------------------------
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'Session cookie set by Better Auth after login.',
        },
      },
      schemas: {
        // -- Error ---------------------------------------------------------
        TRPCError: errorResponse,

        // -- Entities ------------------------------------------------------
        Bundle: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            category: { type: ['string', 'null'] },
            globalSkuId: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        BundleDetail: {
          type: 'object',
          description: 'Bundle with related products and offerings.',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            category: { type: ['string', 'null'] },
            globalSkuId: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            products: {
              type: 'array',
              items: { $ref: '#/components/schemas/Product' },
            },
            productOfferings: {
              type: 'array',
              items: { $ref: '#/components/schemas/ProductOffering' },
            },
          },
        },

        Product: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            externalId: { type: ['string', 'null'] },
            bundleId: { type: 'string' },
          },
        },

        ProductOffering: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            bundleId: { type: 'string' },
            sourceType: { type: 'string', enum: [...VendorType] },
            unitCost: { type: 'string', description: 'Decimal string.' },
            currency: { type: 'string', default: 'USD' },
            minQuantity: { type: 'integer' },
            maxQuantity: { type: ['integer', 'null'] },
            availability: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        PricingOption: {
          type: 'object',
          description: 'A pricing option from a specific distributor.',
          properties: {
            productOfferingId: { type: 'string' },
            sourceType: { type: 'string', enum: [...VendorType] },
            effectiveUnitCost: { type: 'string', description: 'Decimal string.' },
            totalCost: { type: 'string', description: 'Decimal string.' },
            partnerMarginPercent: { type: 'string', description: 'Decimal string.' },
            currency: { type: 'string' },
            availability: { type: 'boolean' },
            minQuantity: { type: 'integer' },
            maxQuantity: { type: ['integer', 'null'] },
            isEligible: { type: 'boolean' },
          },
        },

        Subscription: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            organizationId: { type: 'string' },
            bundleId: { type: 'string' },
            status: { type: 'string', enum: [...SubscriptionStatus] },
            externalId: { type: ['string', 'null'] },
            commitmentEndDate: { type: ['string', 'null'], format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        SubscriptionDetail: {
          type: 'object',
          description: 'Subscription with related bundle, licenses, and vendor connection.',
          properties: {
            id: { type: 'string' },
            organizationId: { type: 'string' },
            bundleId: { type: 'string' },
            status: { type: 'string', enum: [...SubscriptionStatus] },
            externalId: { type: ['string', 'null'] },
            commitmentEndDate: { type: ['string', 'null'], format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            bundle: { $ref: '#/components/schemas/Bundle' },
            licenses: {
              type: 'array',
              items: { $ref: '#/components/schemas/License' },
            },
            vendorConnection: { $ref: '#/components/schemas/VendorConnection' },
          },
        },

        License: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            subscriptionId: { type: 'string' },
            productOfferingId: { type: 'string' },
            quantity: { type: 'integer' },
            pendingQuantity: {
              type: ['integer', 'null'],
              description: 'Target quantity for a staged scale-down, or null.',
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        LicenseDetail: {
          type: 'object',
          description: 'License with related subscription and product offering.',
          properties: {
            id: { type: 'string' },
            subscriptionId: { type: 'string' },
            productOfferingId: { type: 'string' },
            quantity: { type: 'integer' },
            pendingQuantity: { type: ['integer', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            subscription: { $ref: '#/components/schemas/Subscription' },
            productOffering: { $ref: '#/components/schemas/ProductOffering' },
          },
        },

        VendorConnection: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            organizationId: { type: 'string' },
            vendorType: { type: 'string', enum: [...VendorType] },
            status: { type: 'string', enum: [...VendorConnectionStatus] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          description: 'Credentials are never exposed in API responses.',
        },

        PurchaseTransaction: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            organizationId: { type: 'string' },
            subscriptionId: { type: 'string' },
            grossAmount: { type: 'string', description: 'Decimal string.' },
            netAmount: { type: 'string', description: 'Decimal string.' },
            currency: { type: 'string' },
            status: { type: 'string', enum: [...TransactionStatus] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        BillingSnapshot: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            organizationId: { type: 'string' },
            periodStart: { type: 'string', format: 'date-time' },
            periodEnd: { type: 'string', format: 'date-time' },
            totalAmount: { type: 'string', description: 'Decimal string.' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        InvoiceLineItem: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string' },
            bundleName: { type: 'string' },
            vendorType: { type: 'string', enum: [...VendorType] },
            quantity: { type: 'integer' },
            unitCost: { type: 'string', description: 'Decimal string.' },
            lineTotal: { type: 'string', description: 'Decimal string.' },
            pendingQuantity: { type: ['integer', 'null'] },
            commitmentEndDate: { type: ['string', 'null'], format: 'date-time' },
          },
        },

        Member: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            userId: { type: 'string' },
            organizationId: { type: 'string' },
            orgRole: { type: ['string', 'null'], enum: [...OrgRole, null] },
            mspRole: { type: ['string', 'null'], enum: [...MspRole, null] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        Invitation: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            orgRole: { type: ['string', 'null'], enum: [...OrgRole, null] },
            mspRole: { type: ['string', 'null'], enum: [...MspRole, null] },
            status: { type: 'string', enum: [...InvitationStatus] },
            expiresAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        Organization: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            slug: { type: 'string' },
            organizationType: { type: 'string', enum: [...OrganizationType] },
            billingType: { type: 'string', enum: [...BillingType] },
            logo: { type: ['string', 'null'], format: 'uri' },
            isContractSigned: { type: 'boolean' },
            provisioningEnabled: { type: 'boolean' },
            parentOrganizationId: { type: ['string', 'null'] },
            deletedAt: { type: ['string', 'null'], format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        AuditLog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            organizationId: { type: 'string' },
            userId: { type: ['string', 'null'] },
            action: { type: 'string' },
            entityId: { type: ['string', 'null'] },
            entityType: { type: ['string', 'null'] },
            before: { type: ['object', 'null'], description: 'Previous state snapshot.' },
            after: { type: ['object', 'null'], description: 'New state snapshot.' },
            traceId: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        Recommendation: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: ['RIGHT_SIZE', 'COST_OPTIMIZATION', 'COMMITMENT_SUGGESTION'],
            },
            title: { type: 'string' },
            description: { type: 'string' },
            potentialSavings: { type: 'string', description: 'Decimal string.' },
            severity: { type: 'string', enum: [...Severity] },
            entityId: { type: 'string' },
            entityType: { type: 'string', enum: ['LICENSE', 'SUBSCRIPTION'] },
          },
        },

        WasteAlert: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'UNUSED_LICENSE',
                'OVER_PROVISIONED',
                'STALE_SUBSCRIPTION',
                'STALE_PENDING_SCALEDOWN',
              ],
            },
            title: { type: 'string' },
            description: { type: 'string' },
            estimatedWaste: { type: 'string', description: 'Decimal string.' },
            severity: { type: 'string', enum: [...Severity] },
            entityId: { type: 'string' },
            entityType: { type: 'string', enum: ['LICENSE', 'SUBSCRIPTION'] },
            suggestedAction: { type: 'string' },
          },
        },

        InsightSnapshot: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            organizationId: { type: 'string' },
            type: { type: 'string', enum: [...InsightType] },
            severity: { type: 'string', enum: [...Severity] },
            title: { type: 'string' },
            description: { type: 'string' },
            dismissedAt: { type: ['string', 'null'], format: 'date-time' },
            dismissedByUserId: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        Notification: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            organizationId: { type: 'string' },
            userId: { type: 'string' },
            title: { type: 'string' },
            body: { type: ['string', 'null'] },
            readAt: { type: ['string', 'null'], format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  };
}
