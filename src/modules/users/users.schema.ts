import { z } from 'zod';

export const updateUserSchema = z.object({
  body: z.object({
    firstName: z.string().min(1).max(100).trim().optional(),
    lastName: z.string().min(1).max(100).trim().optional(),
    phone: z.string().max(20).trim().optional().nullable(),
    avatarUrl: z.string().url().optional().nullable(),
  }),
});

export const listUsersQuerySchema = z.object({
  query: z.object({
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('20'),
    role: z.enum(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT']).optional(),
    search: z.string().max(100).optional(),
    isActive: z.enum(['true', 'false']).optional(),
  }),
});

export const userIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'User ID is required'),
  }),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>['body'];
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>['query'];
