import { z } from 'zod';

export const createStudentSchema = z.object({
  body: z.object({
    studentCode: z.string().min(1).max(50).trim(),
    firstName: z.string().min(1).max(100).trim(),
    lastName: z.string().min(1).max(100).trim(),
    dateOfBirth: z.string().datetime().optional().nullable(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
    grade: z.string().max(20).trim().optional().nullable(),
    section: z.string().max(20).trim().optional().nullable(),
    guardianName: z.string().max(200).trim().optional().nullable(),
    guardianPhone: z.string().max(20).trim().optional().nullable(),
    guardianEmail: z.string().email().optional().nullable(),
    address: z.string().max(500).trim().optional().nullable(),
    notes: z.string().max(2000).trim().optional().nullable(),
    // userId is optional — if not provided, a user account will be created
    userId: z.string().optional(),
    userEmail: z.string().email().optional(),
  }),
});

export const updateStudentSchema = z.object({
  body: z.object({
    firstName: z.string().min(1).max(100).trim().optional(),
    lastName: z.string().min(1).max(100).trim().optional(),
    dateOfBirth: z.string().datetime().optional().nullable(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
    grade: z.string().max(20).trim().optional().nullable(),
    section: z.string().max(20).trim().optional().nullable(),
    status: z.enum(['ENROLLED', 'GRADUATED', 'SUSPENDED', 'WITHDRAWN']).optional(),
    guardianName: z.string().max(200).trim().optional().nullable(),
    guardianPhone: z.string().max(20).trim().optional().nullable(),
    guardianEmail: z.string().email().optional().nullable(),
    address: z.string().max(500).trim().optional().nullable(),
    notes: z.string().max(2000).trim().optional().nullable(),
  }),
});

export const listStudentsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('20'),
    grade: z.string().optional(),
    section: z.string().optional(),
    status: z.enum(['ENROLLED', 'GRADUATED', 'SUSPENDED', 'WITHDRAWN']).optional(),
    search: z.string().max(100).optional(),
  }),
});

export const studentIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Student ID is required'),
  }),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>['body'];
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>['body'];
export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>['query'];
