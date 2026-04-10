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
