import { Router } from 'express';
import { validate } from '@/middlewares/validate.middleware';
import { authenticate, authorize } from '@/middlewares/auth.middleware';
import { z } from 'zod';
import {
  createFollowUp,
  getFollowUp,
  addInteraction,
  addNote,
  updateStatus,
  listFollowUps,
  getDashboard,
} from './followups.controller';
import {
  createFollowUpSchema,
  addInteractionSchema,
  addNoteSchema,
  updateFollowUpStatusSchema,
  listFollowUpsQuerySchema,
  followUpIdParamSchema,
} from './followups.schema';

const router = Router();

// All follow-up routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/follow-ups/dashboard
 * CRM dashboard stats.
 */
router.get(
  '/dashboard',
  authorize('ADMIN', 'SUPER_ADMIN', 'MARKETING', 'SCHOOL_ADMIN'),
  getDashboard,
);

/**
 * POST /api/v1/follow-ups
 * Create follow-up manually.
 */
router.post(
  '/',
  authorize('ADMIN', 'SUPER_ADMIN', 'MARKETING', 'SCHOOL_ADMIN'),
  validate({ body: createFollowUpSchema }),
  createFollowUp,
);

/**
 * GET /api/v1/follow-ups
 * List with filters.
 */
router.get(
  '/',
  authorize('ADMIN', 'SUPER_ADMIN', 'MARKETING', 'SCHOOL_ADMIN'),
  validate({ query: listFollowUpsQuerySchema }),
  listFollowUps,
);

/**
 * GET /api/v1/follow-ups/:id
 */
router.get(
  '/:id',
  authorize('ADMIN', 'SUPER_ADMIN', 'MARKETING', 'SCHOOL_ADMIN'),
  validate({ params: followUpIdParamSchema }),
  getFollowUp,
);

/**
 * POST /api/v1/follow-ups/:id/interactions
 * Add call/WhatsApp/email log.
 */
router.post(
  '/:id/interactions',
  authorize('ADMIN', 'SUPER_ADMIN', 'MARKETING', 'SCHOOL_ADMIN'),
  validate({ params: followUpIdParamSchema, body: addInteractionSchema }),
  addInteraction,
);

/**
 * POST /api/v1/follow-ups/:id/notes
 */
router.post(
  '/:id/notes',
  authorize('ADMIN', 'SUPER_ADMIN', 'MARKETING', 'SCHOOL_ADMIN'),
  validate({ params: followUpIdParamSchema, body: addNoteSchema }),
  addNote,
);

/**
 * PATCH /api/v1/follow-ups/:id/status
 */
router.patch(
  '/:id/status',
  authorize('ADMIN', 'SUPER_ADMIN', 'MARKETING', 'SCHOOL_ADMIN'),
  validate({ params: followUpIdParamSchema, body: updateFollowUpStatusSchema }),
  updateStatus,
);

export default router;
