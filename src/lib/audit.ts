import type { PrismaClient } from '@prisma/client';

interface AuditLogParams {
  db: PrismaClient;
  organizationId: string;
  userId: string | null;
  action: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  traceId?: string | null;
}

/**
 * Writes an immutable audit log entry.
 * Must be called within the same transaction as the mutation it records.
 */
export async function writeAuditLog({
  db,
  organizationId,
  userId,
  action,
  entityId,
  before,
  after,
  traceId,
}: AuditLogParams): Promise<void> {
  // Use the raw prisma client for audit logs since they need the organizationId injected
  await (db as any).auditLog.create({
    data: {
      organizationId,
      userId,
      action,
      entityId: entityId ?? null,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null,
      traceId: traceId ?? null,
    },
  });
}
