'use strict';

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// LOG_DIR may not be set at the time this module first loads (before dotenv).
// We read it directly from process.env with a fallback.
const logDir = process.env.LOG_DIR || 'logs';
const logLevel = process.env.LOG_LEVEL || 'info';

const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

function makeRotatingTransport(filename, level) {
  return new DailyRotateFile({
    dirname: path.resolve(logDir),
    filename: `${filename}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    level,
    format: jsonFormat,
    zippedArchive: true,
  });
}

const logger = winston.createLogger({
  level: logLevel,
  format: jsonFormat,
  transports: [
    makeRotatingTransport('app', logLevel),
    makeRotatingTransport('error', 'error'),
  ],
  exitOnError: false,
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
        winston.format.errors({ stack: true }),
        winston.format.colorize(),
        winston.format.printf((info) => {
          const { timestamp, level, message, stack, ...rest } = info;
          let text = '';
          const meta = { ...rest };
          if (message && typeof message === 'object') {
            const { msg, ...other } = message;
            text = msg || '';
            Object.assign(meta, other);
          } else {
            text = message != null ? String(message) : '';
          }
          // If a top-level `msg` was passed alongside, prefer it
          if (!text && meta.msg) {
            text = meta.msg;
            delete meta.msg;
          }
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          const stackStr = stack ? '\n' + stack : '';
          return `${timestamp} [${level}] ${text}${metaStr}${stackStr}`;
        }),
      ),
    }),
  );
}

module.exports = logger;
