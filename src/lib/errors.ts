import { TRPCError } from '@trpc/server';

interface RecoveryHint {
  action: string;
  label: string;
  params?: Record<string, unknown>;
}

interface BusinessErrorOptions {
  code: TRPCError['code'];
  message: string;
  errorCode: string;
  recovery?: RecoveryHint;
}

/**
 * Creates a TRPCError with the standard Tally two-layer error format:
 * Layer 1: tRPC transport code (HTTP semantic)
 * Layer 2: Hierarchical business error code in cause
 */
export function createBusinessError({
  code,
  message,
  errorCode,
  recovery,
}: BusinessErrorOptions): TRPCError {
  return new TRPCError({
    code,
    message,
    cause: {
      errorCode,
      ...(recovery && { recovery }),
    },
  });
}

// Pre-built error factories for common cases

export function noOrgContextError(): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'No active organization selected',
    errorCode: 'AUTH:SESSION:NO_ORG',
    recovery: {
      action: 'REDIRECT_ORG_SWITCHER',
      label: 'Select Organization',
    },
  });
}

export function insufficientRoleError(requiredRole: string, currentRole: string): TRPCError {
  return createBusinessError({
    code: 'FORBIDDEN',
    message: 'You do not have permission to perform this action',
    errorCode: 'AUTH:RBAC:INSUFFICIENT',
    recovery: {
      action: 'REQUEST_ACCESS',
      label: 'Request Access',
      params: { requiredRole, currentRole },
    },
  });
}

export function dpaNotAcceptedError(organizationId: string, latestVersion: string): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'Data Processing Agreement must be accepted before proceeding',
    errorCode: 'COMPLIANCE:DPA:NOT_ACCEPTED',
    recovery: {
      action: 'ACCEPT_DPA',
      label: 'Accept DPA',
      params: { organizationId, latestVersion },
    },
  });
}

export function provisioningDisabledError(organizationId: string): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'Provisioning is not enabled for this organization',
    errorCode: 'PROVISION:GATE:DISABLED',
    recovery: {
      action: 'SIGN_CONTRACT',
      label: 'Sign Contract',
      params: { organizationId },
    },
  });
}

export function commitmentWindowActiveError(
  licenseId: string,
  commitmentEndDate: Date,
): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'Scale-down blocked by active commitment window',
    errorCode: 'LICENSE:NCE:WINDOW_ACTIVE',
    recovery: {
      action: 'SCHEDULE_FOR_RENEWAL',
      label: 'Schedule for Next Renewal',
      params: { licenseId, commitmentEndDate },
    },
  });
}

export function pendingScaleDownExistsError(licenseId: string, pendingQuantity: number, inngestRunId: string | null): TRPCError {
  return createBusinessError({
    code: 'CONFLICT',
    message: 'A scale-down is already scheduled for this license',
    errorCode: 'LICENSE:SCALE_DOWN:PENDING',
    recovery: {
      action: 'REVIEW_QUEUE',
      label: 'Review Pending Changes',
      params: { licenseId, pendingQuantity, inngestRunId },
    },
  });
}

export function quantityOutOfRangeError(min: number | null, max: number | null, requested: number): TRPCError {
  return createBusinessError({
    code: 'BAD_REQUEST',
    message: 'Requested quantity is outside the allowed range',
    errorCode: 'LICENSE:QUANTITY:OUT_OF_RANGE',
    recovery: {
      action: 'NONE',
      label: 'Adjust quantity',
      params: { min, max, requested },
    },
  });
}

// ── VENDOR — Distributor Connections & APIs ──

export function vendorAuthExpiredError(vendorType: string, vendorConnectionId: string): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'Vendor credentials have expired',
    errorCode: 'VENDOR:AUTH:EXPIRED',
    recovery: {
      action: 'REAUTH_VENDOR',
      label: 'Reconnect Vendor',
      params: { vendorType, vendorConnectionId },
    },
  });
}

export function vendorAuthDisconnectedError(vendorType: string, vendorConnectionId: string): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'Vendor connection is disconnected',
    errorCode: 'VENDOR:AUTH:DISCONNECTED',
    recovery: {
      action: 'REAUTH_VENDOR',
      label: 'Reconnect Vendor',
      params: { vendorType, vendorConnectionId },
    },
  });
}

export function vendorUpstreamError(vendorType: string): TRPCError {
  return createBusinessError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An error occurred communicating with the distributor',
    errorCode: 'VENDOR:API:UPSTREAM_ERROR',
    recovery: {
      action: 'CONTACT_SUPPORT',
      label: 'Contact Support',
      params: { vendorType },
    },
  });
}

export function vendorRateLimitedError(): TRPCError {
  return createBusinessError({
    code: 'TOO_MANY_REQUESTS',
    message: 'Distributor API rate limit exceeded',
    errorCode: 'VENDOR:API:RATE_LIMITED',
    recovery: {
      action: 'NONE',
      label: 'Retry later',
    },
  });
}

// ── CATALOG — Offerings & Pricing ──

export function offeringUnavailableError(): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'Product offering is not available',
    errorCode: 'CATALOG:OFFERING:UNAVAILABLE',
    recovery: {
      action: 'NONE',
      label: 'Choose a different offering',
    },
  });
}

export function offeringPriceMissingError(vendorConnectionId: string, lastSyncAt: Date | null): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'Pricing data not available — sync required',
    errorCode: 'CATALOG:OFFERING:PRICE_MISSING',
    recovery: {
      action: 'FORCE_SYNC',
      label: 'Sync Now',
      params: { vendorConnectionId, lastSyncAt },
    },
  });
}

// ── PROVISION — Provisioning Validation ──

export function provisionCostMismatchError(estimated: string, actual: string, diffPercent: number): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'Estimated cost differs from vendor actuals',
    errorCode: 'PROVISION:COST:MISMATCH',
    recovery: {
      action: 'MANUAL_OVERRIDE',
      label: 'Review Cost Difference',
      params: { estimated, actual, diffPercent },
    },
  });
}

export function provisionQueueConflictError(conflictingActionId: string, scheduledAt: Date): TRPCError {
  return createBusinessError({
    code: 'CONFLICT',
    message: 'A conflicting action is already scheduled',
    errorCode: 'PROVISION:QUEUE:CONFLICT',
    recovery: {
      action: 'REVIEW_QUEUE',
      label: 'Review Pending Actions',
      params: { conflictingActionId, scheduledAt },
    },
  });
}

// ── COMPLIANCE — Legal & Regulatory Gates ──

export function complianceContractUnsignedError(organizationId: string): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'Organization contract is not signed',
    errorCode: 'COMPLIANCE:CONTRACT:UNSIGNED',
    recovery: {
      action: 'SIGN_CONTRACT',
      label: 'Sign Contract',
      params: { organizationId },
    },
  });
}

// ── DATA — Sync & Freshness ──

export function dataSyncStaleError(vendorConnectionId: string, lastSyncAt: Date | null): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'Vendor data may be outdated — last sync was over 24 hours ago',
    errorCode: 'DATA:SYNC:STALE',
    recovery: {
      action: 'FORCE_SYNC',
      label: 'Sync Now',
      params: { vendorConnectionId, lastSyncAt },
    },
  });
}

// ── ADMIN — Member & Role Management ──

export function memberAlreadyExistsError(): TRPCError {
  return createBusinessError({
    code: 'CONFLICT',
    message: 'User is already a member of this organization',
    errorCode: 'ADMIN:MEMBER:ALREADY_EXISTS',
    recovery: {
      action: 'NONE',
      label: 'View existing member',
    },
  });
}

export function invitationAlreadyPendingError(): TRPCError {
  return createBusinessError({
    code: 'CONFLICT',
    message: 'An invitation is already pending for this email',
    errorCode: 'ADMIN:INVITATION:ALREADY_PENDING',
    recovery: {
      action: 'NONE',
      label: 'View pending invitation',
    },
  });
}

export function invitationExpiredError(): TRPCError {
  return createBusinessError({
    code: 'PRECONDITION_FAILED',
    message: 'This invitation has expired',
    errorCode: 'ADMIN:INVITATION:EXPIRED',
    recovery: {
      action: 'RESEND_INVITATION',
      label: 'Resend Invitation',
    },
  });
}

export function invitationInvalidStatusError(): TRPCError {
  return createBusinessError({
    code: 'BAD_REQUEST',
    message: 'Invitation is not in a valid status for this action',
    errorCode: 'ADMIN:INVITATION:INVALID_STATUS',
    recovery: {
      action: 'NONE',
      label: 'Check invitation status',
    },
  });
}
