import { z } from 'zod';

// ── Create Enrollment ─────────────────────────────────────────────────────────

export const createEnrollmentSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(200)
    .trim(),
  phone: z
    .string()
    .regex(/^\d{10}$/, 'Phone must be exactly 10 digits')
    .trim(),
  email: z
    .string()
    .email('Invalid email address')
    .max(320)
    .trim()
    .toLowerCase(),
  role: z.enum(
    ['STUDENT', 'FRESH_GRADUATE', 'WORKING_PROFESSIONAL', 'CAREER_SWITCHER'],
    { errorMap: () => ({ message: 'Invalid role' }) },
  ),
  education: z
    .enum(['SCHOOL', 'JR_COLLEGE', 'UNDERGRADUATE', 'GRADUATE', 'POST_GRADUATE', 'DOCTORATE', 'OTHER'])
    .optional(),
  readiness: z.enum(['BEGINNER', 'INTERMEDIATE', 'READY_FOR_INTERVIEW']).optional(),
  source: z.enum(['SOCIAL_MEDIA', 'COLLEGE', 'FRIEND', 'GOOGLE', 'OTHER']).optional(),
  // Client-side generated idempotency key (UUID v4)
  idempotencyKey: z.string().uuid('idempotencyKey must be a valid UUID').optional(),
  tenantId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateEnrollmentInput = z.infer<typeof createEnrollmentSchema>;

// ── List Enrollments Query ────────────────────────────────────────────────────

export const listEnrollmentsQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  status: z.enum(['PENDING', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED', 'CANCELLED']).optional(),
  role: z.enum(['STUDENT', 'FRESH_GRADUATE', 'WORKING_PROFESSIONAL', 'CAREER_SWITCHER']).optional(),
  source: z.enum(['SOCIAL_MEDIA', 'COLLEGE', 'FRIEND', 'GOOGLE', 'OTHER']).optional(),
  search: z.string().max(200).optional(),
  from: z.string().optional(),   // ISO date string
  to: z.string().optional(),     // ISO date string
  tenantId: z.string().optional(),
});

export type ListEnrollmentsQuery = z.infer<typeof listEnrollmentsQuerySchema>;

// ── Enrollment ID Param ───────────────────────────────────────────────────────

export const enrollmentIdParamSchema = z.object({
  id: z.string().min(1, 'Enrollment ID is required'),
});

export type EnrollmentIdParam = z.infer<typeof enrollmentIdParamSchema>;
