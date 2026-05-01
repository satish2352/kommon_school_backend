import { v4 as uuidv4 } from 'uuid';
import { ApiError } from '@/utils/ApiError';
import { logger } from '@/config/logger';
import { followUpsRepository } from './followups.repository';
import type {
  CreateFollowUpInput,
  UpdateFollowUpStatusInput,
  AddInteractionInput,
  AddNoteInput,
  ListFollowUpsQuery,
} from './followups.schema';
import type {
  NoteRecord,
  InteractionRecord,
  HistoryRecord,
} from './followups.repository';
import type { Prisma, FollowUpStatus } from '@prisma/client';

export class FollowUpsService {
  /**
   * Create a follow-up record manually.
   * (Auto-creation happens in enrollments.service on enrollment creation.)
   */
  async createFollowUp(input: CreateFollowUpInput, actorId?: string) {
    // Check for existing follow-up for this enrollment
    const existing = await followUpsRepository.findByEnrollmentId(input.enrollmentId);
    if (existing) {
      throw ApiError.conflict('A follow-up already exists for this enrollment');
    }

    const now = new Date();
    const history: HistoryRecord[] = [
      {
        at: now.toISOString(),
        event: 'CREATED',
        actor: actorId ?? 'system',
      },
    ];

    const notes = (input.notes ?? []).map((n) => ({
      id: uuidv4(),
      content: n.content,
      createdAt: now.toISOString(),
      createdBy: actorId ?? 'system',
      metadata: n.metadata ?? {},
    })) as NoteRecord[];

    const followUp = await followUpsRepository.create({
      enrollmentId: input.enrollmentId,
      assignedToId: input.assignedToId ?? null,
      status: (input.status as FollowUpStatus) ?? 'NEW',
      priority: (input.priority as Prisma.EnumFollowUpPriorityFilter) as never,
      nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null,
      tags: input.tags ?? [],
      paymentIntent: (input.paymentIntent ?? {}) as Prisma.InputJsonValue,
      notes: JSON.stringify(notes) as unknown as Prisma.InputJsonValue,
      history: JSON.stringify(history) as unknown as Prisma.InputJsonValue,
      tenantId: input.tenantId ?? null,
    });

    logger.info({ followUpId: followUp.id, enrollmentId: input.enrollmentId }, 'Follow-up created');
    return followUp;
  }

  /**
   * Get follow-up by ID.
   */
  async getFollowUp(id: string) {
    const followUp = await followUpsRepository.findById(id);
    if (!followUp) throw ApiError.notFound('FollowUp');
    return followUp;
  }

  /**
   * Add an interaction (call log, WhatsApp, email) to a follow-up.
   */
  async addInteraction(id: string, input: AddInteractionInput, actorId?: string) {
    const followUp = await followUpsRepository.findById(id);
    if (!followUp) throw ApiError.notFound('FollowUp');

    if (['CONVERTED', 'CLOSED'].includes(followUp.status)) {
      throw ApiError.conflict(`Cannot add interaction to follow-up with status ${followUp.status}`);
    }

    const existing = JSON.parse(
      typeof followUp.interactions === 'string'
        ? followUp.interactions
        : JSON.stringify(followUp.interactions),
    ) as InteractionRecord[];

    const newInteraction: InteractionRecord = {
      id: uuidv4(),
      type: input.type,
      outcome: input.outcome,
      userResponse: input.userResponse,
      callDuration: input.callDuration,
      remarks: input.remarks,
      nextAction: input.nextAction,
      nextFollowUpAt: input.nextFollowUpAt,
      createdAt: new Date().toISOString(),
      createdBy: actorId ?? 'system',
      metadata: input.metadata ?? {},
    };

    existing.push(newInteraction);

    const history = JSON.parse(
      typeof followUp.history === 'string'
        ? followUp.history
        : JSON.stringify(followUp.history),
    ) as HistoryRecord[];

    history.push({
      at: new Date().toISOString(),
      event: 'INTERACTION_ADDED',
      actor: actorId ?? 'system',
    });

    const updateData: Parameters<typeof followUpsRepository.update>[1] = {
      interactions: JSON.stringify(existing) as unknown as Prisma.InputJsonValue,
      history: JSON.stringify(history) as unknown as Prisma.InputJsonValue,
      callAttempts: followUp.callAttempts + (input.type === 'CALL' ? 1 : 0),
      lastActivityAt: new Date(),
    };

    if (input.nextFollowUpAt) {
      updateData.nextFollowUpAt = new Date(input.nextFollowUpAt);
      updateData.dueAt = null; // Reset due flag
    }

    // Auto-transition status based on outcome
    if (input.outcome === 'CONVERTED') {
      updateData.status = 'CONVERTED';
      updateData.convertedAt = new Date();
    } else if (input.outcome === 'NOT_INTERESTED') {
      updateData.status = 'NOT_INTERESTED';
    } else if (
      ['CONNECTED', 'INTERESTED', 'CALLBACK_REQUESTED'].includes(input.outcome) &&
      followUp.status === 'NEW'
    ) {
      updateData.status = 'CONTACTED';
    }

    const updated = await followUpsRepository.update(id, updateData);

    logger.info(
      { followUpId: id, interactionType: input.type, outcome: input.outcome },
      'Interaction added',
    );

    return updated;
  }

  /**
   * Add a note to a follow-up.
   */
  async addNote(id: string, input: AddNoteInput, actorId?: string) {
    const followUp = await followUpsRepository.findById(id);
    if (!followUp) throw ApiError.notFound('FollowUp');

    const existing = JSON.parse(
      typeof followUp.notes === 'string'
        ? followUp.notes
        : JSON.stringify(followUp.notes),
    ) as NoteRecord[];

    const newNote: NoteRecord = {
      id: uuidv4(),
      content: input.content,
      createdAt: new Date().toISOString(),
      createdBy: actorId ?? 'system',
      metadata: input.metadata ?? {},
    };

    existing.push(newNote);

    const history = JSON.parse(
      typeof followUp.history === 'string'
        ? followUp.history
        : JSON.stringify(followUp.history),
    ) as HistoryRecord[];

    history.push({
      at: new Date().toISOString(),
      event: 'NOTE_ADDED',
      actor: actorId ?? 'system',
    });

    const updated = await followUpsRepository.update(id, {
      notes: JSON.stringify(existing) as unknown as Prisma.InputJsonValue,
      history: JSON.stringify(history) as unknown as Prisma.InputJsonValue,
      lastActivityAt: new Date(),
    });

    return updated;
  }

  /**
   * Update follow-up status with optional reassignment and reschedule.
   */
  async updateStatus(id: string, input: UpdateFollowUpStatusInput, actorId?: string) {
    const followUp = await followUpsRepository.findById(id);
    if (!followUp) throw ApiError.notFound('FollowUp');

    if (followUp.status === input.status) {
      return followUp; // No-op
    }

    const history = JSON.parse(
      typeof followUp.history === 'string'
        ? followUp.history
        : JSON.stringify(followUp.history),
    ) as HistoryRecord[];

    history.push({
      at: new Date().toISOString(),
      event: 'STATUS_CHANGED',
      fromStatus: followUp.status,
      toStatus: input.status,
      actor: actorId ?? 'system',
      reason: input.reason,
    });

    const updateData: Parameters<typeof followUpsRepository.update>[1] = {
      status: input.status as FollowUpStatus,
      history: JSON.stringify(history) as unknown as Prisma.InputJsonValue,
      lastActivityAt: new Date(),
    };

    if (input.nextFollowUpAt) updateData.nextFollowUpAt = new Date(input.nextFollowUpAt);
    if (input.assignedToId !== undefined) updateData.assignedToId = input.assignedToId;
    if (input.priority) updateData.priority = input.priority as Prisma.EnumFollowUpPriorityFilter as never;

    if (input.status === 'CONVERTED') {
      updateData.convertedAt = new Date();
    }
    if (input.status === 'CLOSED') {
      updateData.closedAt = new Date();
    }

    const updated = await followUpsRepository.update(id, updateData);

    logger.info(
      { followUpId: id, from: followUp.status, to: input.status, actor: actorId },
      'Follow-up status updated',
    );

    return updated;
  }

  /**
   * List follow-ups with filters.
   */
  async listFollowUps(query: ListFollowUpsQuery) {
    return followUpsRepository.list(query);
  }

  /**
   * Dashboard stats.
   */
  async getDashboard(tenantId?: string | null) {
    return followUpsRepository.getDashboardStats(tenantId);
  }

  // ── Cron handlers ──────────────────────────────────────────────────────────

  /**
   * Mark follow-ups whose nextFollowUpAt <= now as HIGH priority.
   * Returns count updated.
   */
  async markDueReminders(correlationId: string): Promise<number> {
    const now = new Date();
    const dueRecords = await followUpsRepository.findDue(now);

    if (dueRecords.length === 0) {
      logger.debug({ correlationId }, 'markDueReminders: no due follow-ups');
      return 0;
    }

    const ids = dueRecords.map((r) => r.id);
    await followUpsRepository.markDue(ids);

    // Also elevate priority to HIGH
    await Promise.allSettled(
      ids.map((id) =>
        followUpsRepository.update(id, {
          priority: 'HIGH' as import('@prisma/client').FollowUpPriority,
        }),
      ),
    );

    logger.info(
      { correlationId, count: ids.length },
      'markDueReminders: follow-ups marked due and priority elevated',
    );

    return ids.length;
  }

  /**
   * Tag stale leads: FollowUp with lastActivityAt < now - 14d → add 'cold' tag.
   * Returns count updated.
   */
  async markStaleLeads(correlationId: string): Promise<number> {
    const staleBeforeDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const staleRecords = await followUpsRepository.findStaleLeads(staleBeforeDate);

    if (staleRecords.length === 0) {
      logger.debug({ correlationId }, 'markStaleLeads: no stale leads');
      return 0;
    }

    let updated = 0;

    for (const record of staleRecords) {
      try {
        const existing = await followUpsRepository.findById(record.id);
        if (!existing) continue;

        const currentTags = (existing.tags as string[]) ?? [];
        if (currentTags.includes('cold')) continue; // already tagged

        await followUpsRepository.update(record.id, {
          tags: [...currentTags, 'cold'],
        });
        updated++;
      } catch (err) {
        logger.error(
          { err, followUpId: record.id, correlationId },
          'markStaleLeads: error tagging record',
        );
      }
    }

    logger.info(
      { correlationId, scanned: staleRecords.length, tagged: updated },
      'markStaleLeads: complete',
    );

    return updated;
  }

  /**
   * Auto-close NOT_INTERESTED follow-ups with lastContactAt < now - 30d.
   * Returns count closed.
   */
  async autoCloseUninterested(correlationId: string): Promise<number> {
    const staleRecords = await followUpsRepository.findAutoCloseEligible();

    if (staleRecords.length === 0) {
      logger.debug({ correlationId }, 'autoCloseUninterested: nothing to close');
      return 0;
    }

    let closed = 0;

    for (const record of staleRecords) {
      try {
        await followUpsRepository.update(record.id, {
          status: 'CLOSED' as import('@prisma/client').FollowUpStatus,
          closedAt: new Date(),
          lastActivityAt: new Date(),
        });
        closed++;
      } catch (err) {
        logger.error(
          { err, followUpId: record.id, correlationId },
          'autoCloseUninterested: error closing record',
        );
      }
    }

    logger.info(
      { correlationId, closed },
      'autoCloseUninterested: complete',
    );

    return closed;
  }
}

export const followUpsService = new FollowUpsService();
