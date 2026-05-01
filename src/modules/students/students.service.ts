import { Gender, StudentStatus, UserRole, Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import { ApiError } from '@/utils/ApiError';
import { hashPassword } from '@/utils/password';
import { parsePagination } from '@/utils/ApiResponse';
import type { PaginatedResult } from '@/utils/ApiResponse';
import { cacheDelete, buildCacheKey } from '@/utils/cache';
import type { CreateStudentInput, UpdateStudentInput, ListStudentsQuery } from './students.schema';

const studentSelect = {
  id: true,
  tenantId: true,
  studentCode: true,
  firstName: true,
  lastName: true,
  dateOfBirth: true,
  gender: true,
  grade: true,
  section: true,
  enrollmentDate: true,
  status: true,
  guardianName: true,
  guardianPhone: true,
  guardianEmail: true,
  address: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      isActive: true,
    },
  },
} as const;

export class StudentsService {
  async listStudents(
    tenantId: string,
    query: ListStudentsQuery,
  ): Promise<PaginatedResult<unknown>> {
    const { page, limit, skip } = parsePagination(query.page, query.limit);

    const where: Prisma.StudentWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.grade ? { grade: query.grade } : {}),
      ...(query.section ? { section: query.section } : {}),
      ...(query.status ? { status: query.status as StudentStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { studentCode: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.student.findMany({
        where,
        select: studentSelect,
        skip,
        take: limit,
        orderBy: [{ grade: 'asc' }, { lastName: 'asc' }],
      }),
      prisma.student.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getStudentById(id: string, tenantId: string): Promise<unknown> {
    const student = await prisma.student.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: studentSelect,
    });

    if (!student) {
      throw ApiError.notFound('Student');
    }

    return student;
  }

  async createStudent(input: CreateStudentInput, tenantId: string): Promise<unknown> {
    // Check student code uniqueness within tenant
    const existing = await prisma.student.findUnique({
      where: { tenantId_studentCode: { tenantId, studentCode: input.studentCode } },
    });
    if (existing) {
      throw ApiError.conflict(`Student with code "${input.studentCode}" already exists in this school`);
    }

    // Resolve or create linked user
    let userId: string;

    if (input.userId) {
      // Link to existing user
      const user = await prisma.user.findFirst({
        where: { id: input.userId, tenantId, deletedAt: null },
      });
      if (!user) {
        throw ApiError.notFound('User');
      }
      userId = input.userId;
    } else if (input.userEmail) {
      // Create a user account for this student
      const existingUser = await prisma.user.findFirst({
        where: { email: input.userEmail, tenantId, deletedAt: null },
      });
      if (existingUser) {
        throw ApiError.conflict(`User with email "${input.userEmail}" already exists`);
      }

      const tempPassword = await hashPassword(`Student@${Math.random().toString(36).slice(-8)}`);
      const newUser = await prisma.user.create({
        data: {
          email: input.userEmail,
          passwordHash: tempPassword,
          firstName: input.firstName,
          lastName: input.lastName,
          role: UserRole.STUDENT,
          tenantId,
        },
      });
      userId = newUser.id;
    } else {
      throw ApiError.badRequest('Either userId or userEmail must be provided');
    }

    const student = await prisma.student.create({
      data: {
        tenantId,
        userId,
        studentCode: input.studentCode,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
        gender: input.gender as Gender | null ?? null,
        grade: input.grade ?? null,
        section: input.section ?? null,
        guardianName: input.guardianName ?? null,
        guardianPhone: input.guardianPhone ?? null,
        guardianEmail: input.guardianEmail ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
      },
      select: studentSelect,
    });

    return student;
  }

  async updateStudent(
    id: string,
    tenantId: string,
    input: UpdateStudentInput,
  ): Promise<unknown> {
    const existing = await prisma.student.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw ApiError.notFound('Student');
    }

    const updated = await prisma.student.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null } : {}),
        ...(input.gender !== undefined ? { gender: input.gender as Gender | null ?? null } : {}),
        ...(input.grade !== undefined ? { grade: input.grade } : {}),
        ...(input.section !== undefined ? { section: input.section } : {}),
        ...(input.status !== undefined ? { status: input.status as StudentStatus } : {}),
        ...(input.guardianName !== undefined ? { guardianName: input.guardianName } : {}),
        ...(input.guardianPhone !== undefined ? { guardianPhone: input.guardianPhone } : {}),
        ...(input.guardianEmail !== undefined ? { guardianEmail: input.guardianEmail } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      select: studentSelect,
    });

    await cacheDelete(buildCacheKey('student', id));

    return updated;
  }

  async deleteStudent(id: string, tenantId: string): Promise<void> {
    const existing = await prisma.student.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw ApiError.notFound('Student');
    }

    await prisma.student.update({
      where: { id },
      data: { deletedAt: new Date(), status: StudentStatus.WITHDRAWN },
    });

    await cacheDelete(buildCacheKey('student', id));
  }
}

export const studentsService = new StudentsService();
