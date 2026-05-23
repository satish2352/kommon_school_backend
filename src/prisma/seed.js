'use strict';

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const { encrypt, hashPassword } = require('../utils/crypto');
const { PERMISSIONS } = require('../config/constants');

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Permission code descriptions — purely informational, stored in the DB.
// ---------------------------------------------------------------------------
const PERMISSION_DESCRIPTIONS = {
  [PERMISSIONS.ENROLLMENTS_VIEW]: 'View enrollment records',
  [PERMISSIONS.PAYMENTS_VIEW]: 'View payment records',
  [PERMISSIONS.PAYMENTS_RETRY]: 'Retry a failed payment',
  [PERMISSIONS.FOLLOWUPS_VIEW]: 'View followup records and timelines',
  [PERMISSIONS.FOLLOWUPS_MANAGE]: 'Add notes, update status, and trigger payment retries on followups',
  [PERMISSIONS.RAZORPAY_CONFIGS_MANAGE]: 'Create, update, and activate Razorpay gateway configurations',
  [PERMISSIONS.USERS_MANAGE]: 'Create, update, and delete admin users',
  [PERMISSIONS.REPORTS_VIEW]: 'View reporting dashboards and export data',
  [PERMISSIONS.EXTERNAL_API_LOGS_VIEW]: 'View external API sync log entries',
  [PERMISSIONS.AUDIT_LOGS_VIEW]: 'View the system audit log',
  [PERMISSIONS.COURSES_VIEW]: 'View course catalog',
  [PERMISSIONS.COURSES_MANAGE]: 'Create, update, and delete courses',
  [PERMISSIONS.EDUCATION_MASTER_VIEW]: 'View education master records',
  [PERMISSIONS.EDUCATION_MASTER_MANAGE]: 'Create, update, and delete education master records',
  [PERMISSIONS.DURATION_MASTER_VIEW]: 'View duration master records',
  [PERMISSIONS.DURATION_MASTER_MANAGE]: 'Create, update, and delete duration master records',
  [PERMISSIONS.WEBHOOKS_VIEW]: 'View webhook delivery history',
  [PERMISSIONS.WEBHOOKS_TEST]: 'Send test webhooks from the admin panel',
  [PERMISSIONS.PLANS_READ]:             'View plan catalog and pricings',
  [PERMISSIONS.PLANS_CREATE]:           'Create new subscription plans',
  [PERMISSIONS.PLANS_UPDATE]:           'Update plan metadata and pricing',
  [PERMISSIONS.PLANS_DELETE]:           'Delete (non-referenced) plans',
  [PERMISSIONS.PLANS_ENROLLMENTS_READ]: 'View enrollments for a specific plan',
  [PERMISSIONS.ENROLLMENTS_MANUAL_CREATE]: 'Create an enrollment manually without Razorpay payment',
  [PERMISSIONS.ENROLLMENTS_BULK_UPLOAD]:   'Upload a CSV to bulk-create enrollments',
  [PERMISSIONS.INTERNAL_PLANS_VIEW]:   'View internal plans and their coupon/fee details',
  [PERMISSIONS.INTERNAL_PLANS_MANAGE]: 'Create, update, and delete internal plans',
};

// ---------------------------------------------------------------------------
// Role -> permission mapping used for seeding.
// superadmin bypasses all checks in middleware, but we seed the rows anyway
// so the DB reflects the full intended permission set for auditing purposes.
// ---------------------------------------------------------------------------
const ROLE_PERMISSIONS = {
  superadmin: Object.values(PERMISSIONS),
  admin: [
    PERMISSIONS.ENROLLMENTS_VIEW,
    PERMISSIONS.PAYMENTS_VIEW,
    PERMISSIONS.EXTERNAL_API_LOGS_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.AUDIT_LOGS_VIEW,
    PERMISSIONS.FOLLOWUPS_VIEW,
    PERMISSIONS.COURSES_VIEW,
    PERMISSIONS.COURSES_MANAGE,
    PERMISSIONS.EDUCATION_MASTER_VIEW,
    PERMISSIONS.EDUCATION_MASTER_MANAGE,
    PERMISSIONS.DURATION_MASTER_VIEW,
    PERMISSIONS.DURATION_MASTER_MANAGE,
    PERMISSIONS.WEBHOOKS_VIEW,
    PERMISSIONS.WEBHOOKS_TEST,
    PERMISSIONS.PLANS_READ,
    PERMISSIONS.PLANS_CREATE,
    PERMISSIONS.PLANS_UPDATE,
    PERMISSIONS.PLANS_DELETE,
    PERMISSIONS.PLANS_ENROLLMENTS_READ,
    PERMISSIONS.ENROLLMENTS_MANUAL_CREATE,
    PERMISSIONS.ENROLLMENTS_BULK_UPLOAD,
    PERMISSIONS.INTERNAL_PLANS_VIEW,
    PERMISSIONS.INTERNAL_PLANS_MANAGE,
  ],
  marketing: [
    PERMISSIONS.FOLLOWUPS_VIEW,
    PERMISSIONS.FOLLOWUPS_MANAGE,
    PERMISSIONS.PAYMENTS_RETRY,
    PERMISSIONS.ENROLLMENTS_VIEW,
    PERMISSIONS.PLANS_READ,
    PERMISSIONS.PLANS_ENROLLMENTS_READ,
  ],
};

async function seedPermissions() {
  console.log('[seed] seeding permissions...');

  // 1. Upsert every known permission code.
  const allCodes = Object.values(PERMISSIONS);
  const permRows = await Promise.all(
    allCodes.map((code) =>
      prisma.permission.upsert({
        where: { code },
        create: { code, description: PERMISSION_DESCRIPTIONS[code] || null },
        update: { description: PERMISSION_DESCRIPTIONS[code] || null },
      }),
    ),
  );

  // Build a code -> id lookup for the bulk-assign step.
  const codeToId = {};
  for (const row of permRows) {
    codeToId[row.code] = row.id;
  }

  console.log(`[seed] ${permRows.length} permission rows upserted`);

  // 2. For each role, clear existing assignments then re-assign from the
  //    ROLE_PERMISSIONS map so re-runs are idempotent.
  for (const [role, codes] of Object.entries(ROLE_PERMISSIONS)) {
    await prisma.rolePermission.deleteMany({ where: { role } });

    const ids = codes.map((c) => codeToId[c]).filter(Boolean);
    if (ids.length > 0) {
      await prisma.rolePermission.createMany({
        data: ids.map((permission_id) => ({ role, permission_id })),
        skipDuplicates: true,
      });
    }
    console.log(`[seed] role '${role}': assigned ${ids.length} permissions`);
  }
}

async function seedSuperAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('[seed] SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD not set — skipping admin user seed');
    return;
  }

  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    console.log(`[seed] superadmin already exists: ${email}`);
    return;
  }

  const password_hash = await hashPassword(password);
  await prisma.user.create({
    data: { email, password_hash, role: 'superadmin' },
  });
  console.log(`[seed] superadmin created: ${email}`);
}

async function seedRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!keyId || !keySecret || !webhookSecret) {
    console.log('[seed] Razorpay env vars not all set — skipping config seed');
    return;
  }

  const existing = await prisma.razorpayConfiguration.findFirst({
    where: { key_id: keyId },
  });
  if (existing) {
    console.log(`[seed] Razorpay config already exists: ${keyId}`);
    if (!existing.is_active) {
      // Ensure the seeded config is active if no other config is
      const anyActive = await prisma.razorpayConfiguration.findFirst({
        where: { is_active: true },
      });
      if (!anyActive) {
        await prisma.razorpayConfiguration.update({
          where: { id: existing.id },
          data: { is_active: true },
        });
        console.log(`[seed] activated existing config: ${keyId}`);
      }
    }
    return;
  }

  // Deactivate any existing active config so the new one is the sole active row
  await prisma.razorpayConfiguration.updateMany({
    where: { is_active: true },
    data: { is_active: false },
  });

  await prisma.razorpayConfiguration.create({
    data: {
      key_id: keyId,
      key_secret_encrypted: encrypt(keySecret),
      webhook_secret_encrypted: encrypt(webhookSecret),
      is_active: true,
    },
  });
  console.log(`[seed] Razorpay config created and activated: ${keyId}`);
}

async function seedEducationMaster() {
  console.log('[seed] seeding education master...');

  // Non-default rows: explicitly set isSystemDefault: false so any accidental
  // manual flip is corrected on the next seed run.
  const regularRecords = [
    { name: 'School',        code: 'SCHOOL' },
    { name: 'Jr College',    code: 'JR_COLLEGE' },
    { name: 'Undergraduate', code: 'UNDERGRADUATE' },
    { name: 'Graduate',      code: 'GRADUATE' },
    { name: 'Post Graduate', code: 'POST_GRADUATE' },
    { name: 'Doctorate',     code: 'DOCTORATE' },
    { name: 'Other',         code: 'OTHER' },
  ];

  for (const rec of regularRecords) {
    await prisma.educationMaster.upsert({
      where:  { code: rec.code },
      create: { name: rec.name, code: rec.code, status: 'ACTIVE', isSystemDefault: false },
      update: { name: rec.name, isSystemDefault: false },
    });
  }

  // System-default GENERAL row — isSystemDefault: true in both create + update
  // so re-running the seed re-marks the row even if manually flipped.
  await prisma.educationMaster.upsert({
    where:  { code: 'GENERAL' },
    create: {
      name:            'GENERAL',
      code:            'GENERAL',
      description:     'Default general education level — used for courses with no specific education requirement.',
      status:          'ACTIVE',
      isSystemDefault: true,
    },
    update: {
      name:            'GENERAL',
      description:     'Default general education level — used for courses with no specific education requirement.',
      isSystemDefault: true,
    },
  });

  const total = await prisma.educationMaster.count();
  console.log(`[seed] education master: ${total} rows present`);
}

async function seedDurationMaster() {
  console.log('[seed] seeding duration master...');

  // Non-default rows: explicitly set isSystemDefault: false to correct any
  // accidental flag on re-run.
  const regularRecords = [
    { label: '1 Month',  sortOrder: 10 },
    { label: '3 Months', sortOrder: 20 },
    { label: '9 Months', sortOrder: 40 },
    { label: '1 Year',   sortOrder: 50 },
    { label: '2 Years',  sortOrder: 60 },
  ];

  for (const rec of regularRecords) {
    await prisma.durationMaster.upsert({
      where:  { label: rec.label },
      create: { label: rec.label, sortOrder: rec.sortOrder, status: 'ACTIVE', isSystemDefault: false },
      update: { sortOrder: rec.sortOrder, isSystemDefault: false },
    });
  }

  // System-default: "6 Months" — isSystemDefault: true in both create + update.
  await prisma.durationMaster.upsert({
    where:  { label: '6 Months' },
    create: { label: '6 Months', sortOrder: 30, status: 'ACTIVE', isSystemDefault: true },
    update: { sortOrder: 30, isSystemDefault: true },
  });

  const total = await prisma.durationMaster.count();
  console.log(`[seed] duration master: ${total} rows present`);
}

async function seedCourses() {
  console.log('[seed] seeding course master...');

  // Look up master IDs at runtime — never hardcode
  const eduGeneral      = await prisma.educationMaster.findUnique({ where: { code: 'GENERAL' } });
  const eduGraduate     = await prisma.educationMaster.findUnique({ where: { code: 'GRADUATE' } });
  const eduUndergrad    = await prisma.educationMaster.findUnique({ where: { code: 'UNDERGRADUATE' } });

  const dur3Months      = await prisma.durationMaster.findUnique({ where: { label: '3 Months' } });
  const dur6Months      = await prisma.durationMaster.findUnique({ where: { label: '6 Months' } });

  // Regular (non-system-default) courses.
  // isSystemDefault: false is set explicitly in the update branch so any
  // accidental flag gets cleared on re-run.
  const regularCourses = [
    {
      nameOfCourseAsGroup: 'Data Science and AIML',
      coupon: 'EARLYBIRD20',
      courseFee: 49999.00,
      description: 'Comprehensive program covering Python, machine learning, and deep learning with real-world projects.',
      status: 'ACTIVE',
      educationId: eduGraduate?.id ?? null,
      durationId:  dur6Months?.id ?? null,
    },
    {
      nameOfCourseAsGroup: 'Full Stack Java Development',
      coupon: 'WELCOME15',
      courseFee: 44999.00,
      description: 'End-to-end Java development covering Spring Boot, REST APIs, and modern front-end integration.',
      status: 'ACTIVE',
      educationId: eduGraduate?.id ?? null,
      durationId:  dur6Months?.id ?? null,
    },
    {
      nameOfCourseAsGroup: 'Mobile Application Development',
      coupon: 'LAUNCH10',
      courseFee: 39999.00,
      description: 'Build cross-platform mobile apps using React Native with hands-on project experience.',
      status: 'ACTIVE',
      educationId: eduUndergrad?.id ?? null,
      durationId:  dur3Months?.id ?? null,
    },
    {
      nameOfCourseAsGroup: 'Web Designing & Development using React',
      coupon: 'EARLYBIRD20',
      courseFee: 34999.00,
      description: 'Master modern web design and React development including Tailwind CSS and component architecture.',
      status: 'ACTIVE',
      educationId: eduUndergrad?.id ?? null,
      durationId:  dur3Months?.id ?? null,
    },
    {
      nameOfCourseAsGroup: 'Data Analytics Using Python',
      coupon: 'WELCOME15',
      courseFee: 29999.00,
      description: 'Learn data analytics, visualization, and reporting using Python, Pandas, and Power BI.',
      status: 'ACTIVE',
      educationId: eduGraduate?.id ?? null,
      durationId:  dur3Months?.id ?? null,
    },
    {
      nameOfCourseAsGroup: 'UI / UX Designing',
      coupon: 'LAUNCH10',
      courseFee: 24999.00,
      description: 'Design user-centric interfaces using Figma and industry-standard UX principles and prototyping.',
      status: 'ACTIVE',
      educationId: eduUndergrad?.id ?? null,
      durationId:  dur3Months?.id ?? null,
    },
    {
      nameOfCourseAsGroup: 'Full Stack Development using Python',
      coupon: 'EARLYBIRD20',
      courseFee: 44999.00,
      description: 'Build complete web applications using Django, REST Framework, and modern JavaScript front-end.',
      status: 'ACTIVE',
      educationId: eduGraduate?.id ?? null,
      durationId:  dur6Months?.id ?? null,
    },
  ];

  let created = 0;
  let updated = 0;

  for (const course of regularCourses) {
    const { nameOfCourseAsGroup, ...data } = course;
    const existing = await prisma.courseMaster.findFirst({
      where: { nameOfCourseAsGroup },
    });
    if (existing) {
      // Update FK references on existing rows; explicitly clear any accidental flag.
      await prisma.courseMaster.update({
        where: { id: existing.id },
        data: {
          educationId:     data.educationId,
          durationId:      data.durationId,
          isSystemDefault: false,
        },
      });
      updated++;
    } else {
      const cn = await prisma.courseNameMaster.upsert({
        where:  { name: nameOfCourseAsGroup },
        update: {},
        create: { name: nameOfCourseAsGroup, status: 'ACTIVE' },
      });
      await prisma.courseMaster.create({
        data: {
          nameOfCourseAsGroup,
          ...data,
          isSystemDefault: false,
          courseNameId: cn.id,
        },
      });
      created++;
    }
  }

  // System-default GENERAL course.
  // Uses findFirst on nameOfCourseAsGroup === 'GENERAL' as the idempotency key.
  const generalExisting = await prisma.courseMaster.findFirst({
    where: { nameOfCourseAsGroup: 'GENERAL' },
  });
  if (generalExisting) {
    await prisma.courseMaster.update({
      where: { id: generalExisting.id },
      data: {
        coupon:          'NEW501',
        courseFee:       1500,
        description:     'Default placeholder course used when a specific catalog course is not selected.',
        status:          'ACTIVE',
        educationId:     eduGeneral?.id ?? null,
        durationId:      dur6Months?.id ?? null,
        isSystemDefault: true,
      },
    });
    updated++;
  } else {
    const generalCn = await prisma.courseNameMaster.upsert({
      where:  { name: 'GENERAL' },
      update: {},
      create: { name: 'GENERAL', status: 'ACTIVE', isSystemDefault: true },
    });
    await prisma.courseMaster.create({
      data: {
        nameOfCourseAsGroup: 'GENERAL',
        coupon:              'NEW501',
        courseFee:           1500,
        description:         'Default placeholder course used when a specific catalog course is not selected.',
        status:              'ACTIVE',
        educationId:         eduGeneral?.id ?? null,
        durationId:          dur6Months?.id ?? null,
        isSystemDefault:     true,
        courseNameId:        generalCn.id,
      },
    });
    created++;
  }

  console.log(`[seed] courses: ${created} created, ${updated} updated`);
}

async function seedPlans() {
  console.log('[seed] seeding plans...');

  // Plan definitions — all system-default, ACTIVE
  const planDefs = [
    {
      tier:           'SILVER',
      name:           'Silver',
      tagline:        'Get started',
      highlightLabel: null,
      promoCode:      'NEW501',
      sortOrder:      1,
      features:       [
        'Access to core video library',
        'Weekly practice sets',
        'Email support',
        'Mobile + desktop access',
      ],
    },
    {
      tier:           'GOLD',
      name:           'Gold',
      tagline:        'Most chosen',
      highlightLabel: 'Most Popular',
      promoCode:      'NEW501',
      sortOrder:      2,
      features:       [
        'Everything in Silver',
        '1:1 monthly mentor session',
        'Mock interviews (2/month)',
        'Priority email + chat support',
        'Resume + LinkedIn review',
      ],
    },
    {
      tier:           'PLATINUM',
      name:           'Platinum',
      tagline:        'Maximum value',
      highlightLabel: 'Best Value',
      promoCode:      'NEW501',
      sortOrder:      3,
      features:       [
        'Everything in Gold',
        'Unlimited 1:1 mentor sessions',
        'Mock interviews (unlimited)',
        'Dedicated career coach',
        'Job referral network access',
        'Capstone project review',
      ],
    },
  ];

  // Pricing matrix keyed by tier
  const pricingMatrix = {
    SILVER: [
      { durationMonths: 1,  basePrice: 499.00,   discountPercent: 0,  finalPrice: 499.00,   discountLabel: null },
      { durationMonths: 3,  basePrice: 1497.00,  discountPercent: 5,  finalPrice: 1422.15,  discountLabel: 'Save 5%' },
      { durationMonths: 6,  basePrice: 2994.00,  discountPercent: 10, finalPrice: 2694.60,  discountLabel: 'Save 10%' },
      { durationMonths: 12, basePrice: 5988.00,  discountPercent: 15, finalPrice: 5089.80,  discountLabel: 'Save 15%' },
    ],
    GOLD: [
      { durationMonths: 1,  basePrice: 999.00,   discountPercent: 0,  finalPrice: 999.00,   discountLabel: null },
      { durationMonths: 3,  basePrice: 2997.00,  discountPercent: 5,  finalPrice: 2847.15,  discountLabel: 'Save 5%' },
      { durationMonths: 6,  basePrice: 5994.00,  discountPercent: 10, finalPrice: 5394.60,  discountLabel: 'Save 10%' },
      { durationMonths: 12, basePrice: 11988.00, discountPercent: 15, finalPrice: 10189.80, discountLabel: 'Save 15%' },
    ],
    PLATINUM: [
      { durationMonths: 1,  basePrice: 1999.00,  discountPercent: 0,  finalPrice: 1999.00,  discountLabel: null },
      { durationMonths: 3,  basePrice: 5997.00,  discountPercent: 5,  finalPrice: 5697.15,  discountLabel: 'Save 5%' },
      { durationMonths: 6,  basePrice: 11994.00, discountPercent: 10, finalPrice: 10794.60, discountLabel: 'Save 10%' },
      { durationMonths: 12, basePrice: 23988.00, discountPercent: 15, finalPrice: 20389.80, discountLabel: 'Save 15%' },
    ],
  };

  let plansCreated = 0;
  let plansUpdated = 0;
  let pricingsCreated = 0;
  let pricingsUpdated = 0;

  for (const def of planDefs) {
    const existing = await prisma.plan.findUnique({ where: { tier: def.tier } });

    let plan;
    if (existing) {
      plan = await prisma.plan.update({
        where: { tier: def.tier },
        data: {
          name:           def.name,
          tagline:        def.tagline,
          highlightLabel: def.highlightLabel,
          promoCode:      def.promoCode,
          sortOrder:      def.sortOrder,
          features:       def.features,
          status:         'ACTIVE',
          isSystemDefault: true,
        },
      });
      plansUpdated++;
    } else {
      plan = await prisma.plan.create({
        data: {
          tier:           def.tier,
          name:           def.name,
          tagline:        def.tagline,
          highlightLabel: def.highlightLabel,
          promoCode:      def.promoCode,
          sortOrder:      def.sortOrder,
          features:       def.features,
          status:         'ACTIVE',
          isSystemDefault: true,
        },
      });
      plansCreated++;
    }

    // Upsert pricing rows for this plan
    for (const pricing of pricingMatrix[def.tier]) {
      const existingPricing = await prisma.planPricing.findUnique({
        where: { planId_durationMonths: { planId: plan.id, durationMonths: pricing.durationMonths } },
      });

      if (existingPricing) {
        await prisma.planPricing.update({
          where: { id: existingPricing.id },
          data: {
            basePrice:       pricing.basePrice,
            discountPercent: pricing.discountPercent,
            finalPrice:      pricing.finalPrice,
            discountLabel:   pricing.discountLabel,
            status:          'ACTIVE',
          },
        });
        pricingsUpdated++;
      } else {
        await prisma.planPricing.create({
          data: {
            planId:          plan.id,
            durationMonths:  pricing.durationMonths,
            basePrice:       pricing.basePrice,
            discountPercent: pricing.discountPercent,
            finalPrice:      pricing.finalPrice,
            discountLabel:   pricing.discountLabel,
            status:          'ACTIVE',
          },
        });
        pricingsCreated++;
      }
    }
  }

  console.log(`[seed] plans: ${plansCreated} created, ${plansUpdated} updated`);
  console.log(`[seed] plan pricings: ${pricingsCreated} created, ${pricingsUpdated} updated`);
}

async function main() {
  // Permissions must be seeded before users so role assignments are ready.
  await seedPermissions();
  await seedSuperAdmin();
  await seedRazorpayConfig();
  // Masters must be seeded before courses (FK references)
  await seedEducationMaster();
  await seedDurationMaster();
  await seedCourses();
  await seedPlans();
}

main()
  .catch((err) => {
    console.error('[seed] failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
