import { z } from 'zod';

// ── Shared sub-schemas ────────────────────────────────────────────────────────

const interactionSchema = z.object({
  type: z.enum(['CALL', 'WHATSAPP', 'EMAIL']),
  outcome: z.enum([
    'CONNECTED',
    'NOT_CONNECTED',
    'BUSY',
    'WRONG_NUMBER',
    'VOICEMAIL',
    'CALLBACK_REQUESTED',
    'INTERESTED',
    'NOT_INTERESTED',
    'CONVERTED',
  ]),
  userResponse: z
    .enum(['VERY_INTERESTED', 'INTERESTED', 'NEUTRAL', 'NOT_INTERESTED', 'DO_NOT_CONTACT'])
    .optional(),
  callDuration: z.number().int().min(0).optional(), // seconds
  remarks: z.string().max(2000).optional(),
  nextAction: z.string().max(500).optional(),
  nextFollowUpAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type InteractionInput = z.infer<typeof interactionSchema>;

const noteSchema = z.object({
  content: z.string().min(1).max(5000),
  metadata: z.record(z.unknown()).optional(),
});

export type NoteInput = z.infer<typeof noteSchema>;

// ── Create FollowUp ───────────────────────────────────────────────────────────

export const createFollowUpSchema = z.object({
  enrollmentId: z.string().min(1, 'enrollmentId is required'),
  assignedToId: z.string().optional(),
  status: z
    .enum(['NEW', 'CONTACTED', 'FOLLOW_UP', 'CALLBACK', 'PAYMENT_PENDING', 'CONVERTED', 'NOT_INTERESTED', 'CLOSED'])
    .optional()
    .default('NEW'),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    .optional()
    .default('MEDIUM'),
  nextFollowUpAt: z.string().datetime().optional(),
  tags: z.array(z.string().max(50)).optional(),
  paymentIntent: z.record(z.unknown()).optional(),
  notes: z.array(noteSchema).optional(),
  tenantId: z.string().optional(),
});

export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;

// ── Update Status ─────────────────────────────────────────────────────────────

export const updateFollowUpStatusSchema = z.object({
  status: z.enum([
    'NEW',
    'CONTACTED',
    'FOLLOW_UP',
    'CALLBACK',
    'PAYMENT_PENDING',
    'CONVERTED',
    'NOT_INTERESTED',
    'CLOSED',
  ]),
  reason: z.string().max(500).optional(),
  nextFollowUpAt: z.string().datetime().optional(),
  assignedToId: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
});

export type UpdateFollowUpStatusInput = z.infer<typeof updateFollowUpStatusSchema>;

// ── Add Interaction ───────────────────────────────────────────────────────────

export const addInteractionSchema = interactionSchema;
export type AddInteractionInput = z.infer<typeof addInteractionSchema>;

// ── Add Note ──────────────────────────────────────────────────────────────────

export const addNoteSchema = noteSchema;
export type AddNoteInput = z.infer<typeof addNoteSchema>;

// ── List FollowUps ────────────────────────────────────────────────────────────

export const listFollowUpsQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  status: z
    .enum(['NEW', 'CONTACTED', 'FOLLOW_UP', 'CALLBACK', 'PAYMENT_PENDING', 'CONVERTED', 'NOT_INTERESTED', 'CLOSED'])
    .optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assignedToId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  tenantId: z.string().optional(),
  search: z.string().max(200).optional(),
  overdue: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type ListFollowUpsQuery = z.infer<typeof listFollowUpsQuerySchema>;

// ── Param ─────────────────────────────────────────────────────────────────────

export const followUpIdParamSchema = z.object({
  id: z.string().min(1, 'Follow-up ID is required'),
});
