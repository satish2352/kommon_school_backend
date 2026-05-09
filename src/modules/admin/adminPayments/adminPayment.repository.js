'use strict';

const { getPrismaClient } = require('../../../config/database');

const ENROLLMENT_SELECT = {
  id:              true,
  enrollment_code: true,
  name:            true,
  first_name:      true,
  last_name:       true,
  email:           true,
  phone_number:    true,
};

/**
 * Paginated list of payments with an optional Prisma where clause.
 * Returns { rows, total } via a $transaction of findMany + count.
 *
 * @param {{ skip: number, take: number, where: object, orderBy: object }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function listPayments({ skip, take, where, orderBy }) {
  const db = getPrismaClient();
  const [rows, total] = await db.$transaction([
    db.payment.findMany({
      skip,
      take,
      where,
      orderBy,
      include: {
        enrollment: { select: ENROLLMENT_SELECT },
      },
    }),
    db.payment.count({ where }),
  ]);
  return { rows, total };
}

module.exports = { listPayments };
