'use strict';

const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

let prisma;

function getPrismaClient() {
  if (!prisma) {
    prisma = new PrismaClient({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });

    prisma.$on('error', (e) => {
      logger.error({ msg: 'Prisma error', target: e.target, message: e.message });
    });

    prisma.$on('warn', (e) => {
      logger.warn({ msg: 'Prisma warning', target: e.target, message: e.message });
    });
  }
  return prisma;
}

async function disconnectPrisma() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

module.exports = { getPrismaClient, disconnectPrisma };
