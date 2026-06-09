'use strict';

const { getPrismaClient } = require('../../../config/database');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');

// Dedicated to role='employee' — distinct from the broader /admin/users
// endpoint (which serves user-management CRUD for ALL roles). Keeping it
// separate means future tweaks (status flag, performance metrics, etc.)
// don't risk breaking user-management UX.

/**
 * List employees suitable for an assignment dropdown.
 * Returns the minimal projection: id, email, role, deleted_at, created_at.
 *
 * @param {{ activeOnly?: boolean, search?: string, limit?: number }} query
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function listEmployees(query) {
  const db = getPrismaClient();
  const where = { role: 'employee' };

  // Default: hide soft-deleted accounts. Admin can opt in to seeing all.
  if (query.activeOnly !== false) {
    where.deleted_at = null;
  }

  if (query.search && query.search.trim()) {
    where.email = { contains: query.search.trim(), mode: 'insensitive' };
  }

  const [rows, total] = await db.$transaction([
    db.user.findMany({
      where,
      take: query.limit ?? 200,
      orderBy: { email: 'asc' },
      select: {
        id:         true,
        email:      true,
        role:       true,
        deleted_at: true,
        created_at: true,
      },
    }),
    db.user.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Assign (or unassign) a single enrollment to an employee.
 *
 * - Writes enrollments.assigned_to atomically.
 * - Verifies the target employeeId (if provided) actually exists, is
 *   role='employee', and is not soft-deleted — prevents an admin from
 *   pointing a lead at an arbitrary user.
 * - Audit-logs the change (previous → new) via the existing audit_logs
 *   table so every assignment is traceable for compliance.
 * - Idempotent: assigning to the same employee a second time still emits
 *   an audit row (action is the source of truth, not the state change).
 *
 * @param {{ enrollmentId: string, employeeId: string|null, actorId: string, actorEmail: string, reason?: string, traceId?: string, ip?: string, userAgent?: string }} opts
 * @returns {Promise<object>} the updated enrollment row (id + assigned_to)
 */
async function assignEnrollment({
  enrollmentId,
  employeeId,
  actorId,
  actorEmail,
  reason,
  traceId,
  ip,
  userAgent,
}) {
  const db = getPrismaClient();

  // Load the enrollment first so we know the previous assignee for the
  // audit log AND so we return a friendly 404 instead of a Prisma error.
  const existing = await db.enrollment.findFirst({
    where:  { id: enrollmentId, deleted_at: null },
    select: { id: true, assigned_to: true, email: true },
  });
  if (!existing) {
    throw ApiError.notFound('Enrollment not found');
  }

  // Validate target employee when not unassigning.
  if (employeeId) {
    const target = await db.user.findFirst({
      where: { id: employeeId, role: 'employee', deleted_at: null },
      select: { id: true },
    });
    if (!target) {
      throw ApiError.badRequest(
        'Target employee not found or inactive',
        'EMPLOYEE_INVALID',
      );
    }
  }

  // Update + audit in a single transaction so a partial write can't leave
  // us with an assignment that has no audit trail.
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.enrollment.update({
      where: { id: enrollmentId },
      data:  { assigned_to: employeeId },
      select: {
        id:          true,
        assigned_to: true,
        email:       true,
        status:      true,
        updated_at:  true,
      },
    });

    await tx.auditLog.create({
      data: {
        actor_id:    actorId    ?? null,
        actor_email: actorEmail ?? null,
        action:      employeeId ? 'enrollment.assigned' : 'enrollment.unassigned',
        entity_type: 'enrollment',
        entity_id:   enrollmentId,
        changes: {
          from:   existing.assigned_to,
          to:     employeeId,
          reason: reason || null,
        },
        ip_address: ip || null,
        user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
        trace_id:   traceId   || null,
      },
    });

    return row;
  });

  logger.info({
    msg:           'enrollment_assigned',
    traceId,
    enrollment_id: enrollmentId,
    actor_id:      actorId,
    from:          existing.assigned_to,
    to:            employeeId,
  });

  return updated;
}

/**
 * Bulk variant. Same validation, audit, and idempotency guarantees as
 * assignEnrollment, but processes a list of enrollment ids in chunks so
 * one bad id (already deleted, etc.) does not nuke the entire batch.
 *
 * Each id gets a per-row result: { id, ok, error? }. The caller decides
 * how to surface partial failures in the UI (a banner with N succeeded,
 * M failed, etc.).
 *
 * @param {{ enrollmentIds: string[], employeeId: string|null, ... }} opts
 * @returns {Promise<{ succeeded: number, failed: number, results: Array }>}
 */
async function bulkAssignEnrollments({
  enrollmentIds,
  employeeId,
  actorId,
  actorEmail,
  reason,
  traceId,
  ip,
  userAgent,
}) {
  // Verify target employee once up front — saves N round-trips.
  if (employeeId) {
    const db = getPrismaClient();
    const target = await db.user.findFirst({
      where: { id: employeeId, role: 'employee', deleted_at: null },
      select: { id: true },
    });
    if (!target) {
      throw ApiError.badRequest(
        'Target employee not found or inactive',
        'EMPLOYEE_INVALID',
      );
    }
  }

  const results = [];
  let succeeded = 0;
  let failed = 0;

  // Sequential rather than parallel so we don't slam Postgres and so the
  // audit log timeline reads sensibly (one entry per row, in order).
  for (const enrollmentId of enrollmentIds) {
    try {
      await assignEnrollment({
        enrollmentId,
        employeeId,
        actorId,
        actorEmail,
        reason,
        traceId,
        ip,
        userAgent,
      });
      succeeded += 1;
      results.push({ id: enrollmentId, ok: true });
    } catch (err) {
      failed += 1;
      results.push({
        id:    enrollmentId,
        ok:    false,
        code:  err?.code  || 'UNKNOWN',
        error: err?.message || String(err),
      });
    }
  }

  logger.info({
    msg:        'enrollment_bulk_assigned',
    traceId,
    actor_id:   actorId,
    target_id:  employeeId,
    succeeded,
    failed,
    total:      enrollmentIds.length,
  });

  return { succeeded, failed, results };
}

module.exports = {
  listEmployees,
  assignEnrollment,
  bulkAssignEnrollments,
};
