import { PrismaClient, UserRole, TenantStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding database...');

  // ── Super Admin (no tenant) ──────────────────────────────
  const superAdminPasswordHash = await bcrypt.hash('SuperAdmin@123', 12);
  const superAdmin = await prisma.user.upsert({
    where: { email_tenantId: { email: 'superadmin@kommon.school', tenantId: null as unknown as string } },
    update: {},
    create: {
      email: 'superadmin@kommon.school',
      passwordHash: superAdminPasswordHash,
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.SUPER_ADMIN,
      isEmailVerified: true,
      isActive: true,
    },
  });
  console.log('Super admin created:', superAdmin.email);

  // ── Demo Tenant (School) ─────────────────────────────────
  const demoTenant = await prisma.tenant.upsert({
    where: { slug: 'greenwood-high' },
    update: {},
    create: {
      name: 'Greenwood High School',
      slug: 'greenwood-high',
      domain: 'greenwood.kommon.school',
      status: TenantStatus.ACTIVE,
      email: 'admin@greenwood.edu',
      phone: '+1-555-0100',
      address: '123 School Street, Springfield, IL 62701',
      timezone: 'America/Chicago',
      locale: 'en',
    },
  });
  console.log('Demo tenant created:', demoTenant.slug);

  // ── School Admin ─────────────────────────────────────────
  const schoolAdminPasswordHash = await bcrypt.hash('SchoolAdmin@123', 12);
  const schoolAdmin = await prisma.user.upsert({
    where: { email_tenantId: { email: 'admin@greenwood.edu', tenantId: demoTenant.id } },
    update: {},
    create: {
      tenantId: demoTenant.id,
      email: 'admin@greenwood.edu',
      passwordHash: schoolAdminPasswordHash,
      firstName: 'Jane',
      lastName: 'Doe',
      role: UserRole.SCHOOL_ADMIN,
      isEmailVerified: true,
      isActive: true,
    },
  });
  console.log('School admin created:', schoolAdmin.email);

  // ── Teacher ──────────────────────────────────────────────
  const teacherPasswordHash = await bcrypt.hash('Teacher@123', 12);
  const teacher = await prisma.user.upsert({
    where: { email_tenantId: { email: 'teacher@greenwood.edu', tenantId: demoTenant.id } },
    update: {},
    create: {
      tenantId: demoTenant.id,
      email: 'teacher@greenwood.edu',
      passwordHash: teacherPasswordHash,
      firstName: 'John',
      lastName: 'Smith',
      role: UserRole.TEACHER,
      isEmailVerified: true,
      isActive: true,
    },
  });
  console.log('Teacher created:', teacher.email);

  // ── Student User + Student Record ────────────────────────
  const studentPasswordHash = await bcrypt.hash('Student@123', 12);
  const studentUser = await prisma.user.upsert({
    where: { email_tenantId: { email: 'student@greenwood.edu', tenantId: demoTenant.id } },
    update: {},
    create: {
      tenantId: demoTenant.id,
      email: 'student@greenwood.edu',
      passwordHash: studentPasswordHash,
      firstName: 'Alice',
      lastName: 'Johnson',
      role: UserRole.STUDENT,
      isEmailVerified: true,
      isActive: true,
    },
  });
  console.log('Student user created:', studentUser.email);

  const student = await prisma.student.upsert({
    where: { userId: studentUser.id },
    update: {},
    create: {
      tenantId: demoTenant.id,
      userId: studentUser.id,
      studentCode: 'GH-2026-001',
      firstName: 'Alice',
      lastName: 'Johnson',
      grade: '10',
      section: 'A',
      guardianName: 'Robert Johnson',
      guardianPhone: '+1-555-0200',
      guardianEmail: 'robert.johnson@example.com',
    },
  });
  console.log('Student record created:', student.studentCode);

  console.log('Database seeded successfully!');
  console.log('\nCredentials:');
  console.log('  Super Admin: superadmin@kommon.school / SuperAdmin@123');
  console.log('  School Admin: admin@greenwood.edu / SchoolAdmin@123  (tenant: greenwood-high)');
  console.log('  Teacher: teacher@greenwood.edu / Teacher@123  (tenant: greenwood-high)');
  console.log('  Student: student@greenwood.edu / Student@123  (tenant: greenwood-high)');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
