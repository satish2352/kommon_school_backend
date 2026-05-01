import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@/config/database';
import { ApiError } from '@/utils/ApiError';
import { logger } from '@/config/logger';
import { enrollmentsRepository } from './enrollments.repository';
import type { CreateEnrollmentInput, ListEnrollmentsQuery } from './enrollments.schema';
import type { Prisma } from '@prisma/client';

// Conditionally import date-fns (it's in node_modules via transitive deps)
// If not available fall back to native date formatting
function formatEnrollmentId(date: Date, suffix: string): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `ENR-${y}${m}${d}-${suffix}`;
}

function generateSuffix(): string {
  // 6-character alphanumeric suffix (uppercase)
  return uuidv4().replace(/-/g, '').toUpperCase().slice(0, 6);
}

export class EnrollmentsService {
  /**
   * Create a new enrollment with dedupe and idempotency.
   *
   * Dedup rules:
   *  - If the same idempotencyKey is used → return the existing enrollment
   *  - If the same email OR phone is found → return 409 with existing record
   */
  async createEnrollment(input: CreateEnrollmentInput) {
    const { idempotencyKey: clientKey, ...data } = input;
    const key = clientKey ?? uuidv4();

    // 1. Idempotency check
    const existingByKey = await enrollmentsRepository.findByIdempotencyKey(key);
    if (existingByKey) {
      logger.info({ enrollmentId: existingByKey.enrollmentId, key }, 'Idempotent enrollment create');
      return { enrollment: existingByKey, created: false };
    }

    // 2. Dedupe check (email or phone)
    const duplicate = await enrollmentsRepository.findByEmailOrPhone(data.email, data.phone);
    if (duplicate) {
      throw ApiError.conflict(
        `An enrollment already exists for this email or phone number. Enrollment ID: ${duplicate.enrollmentId}`,
      );
    }

    // 3. Generate human-readable enrollment ID
    const now = new Date();
    const suffix = generateSuffix();
    const enrollmentId = formatEnrollmentId(now, suffix);

    // 4. Create enrollment
    const enrollment = await enrollmentsRepository.create({
      ...data,
      enrollmentId,
      idempotencyKey: key,
      metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
    });

    logger.info(
      { enrollmentId: enrollment.enrollmentId, email: enrollment.email, phone: enrollment.phone },
      'Enrollment created',
    );

    // 5. Auto-create FollowUp record (CRM lead)
    try {
      await prisma.followUp.create({
        data: {
          enrollmentId: enrollment.id,
          tenantId: enrollment.tenantId ?? null,
          status: 'NEW',
          priority: 'MEDIUM',
          history: JSON.stringify([
            {
              at: now.toISOString(),
              event: 'CREATED',
              actor: 'system',
            },
          ]),
        },
      });
    } catch (err) {
      // Non-fatal: follow-up creation failure should not block enrollment
      logger.warn({ err, enrollmentId: enrollment.enrollmentId }, 'Failed to auto-create follow-up');
    }

    return { enrollment, created: true };
  }

  /**
   * Get enrollment by ID (cuid).
   */
  async getEnrollment(id: string) {
    const enrollment = await enrollmentsRepository.findById(id);
    if (!enrollment) {
      throw ApiError.notFound('Enrollment');
    }
    return enrollment;
  }

  /**
   * List enrollments with filters and pagination.
   */
  async listEnrollments(query: ListEnrollmentsQuery) {
    return enrollmentsRepository.list(query);
  }
}

export const enrollmentsService = new EnrollmentsService();
