import pino from 'pino';
import { env } from './env';

const transport =
  env.LOG_PRETTY
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      }
    : undefined;

export const logger = pino({
  level: env.LOG_LEVEL === 'silent' ? 'silent' : env.LOG_LEVEL,
  transport,
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'authorization',
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'body.newPassword',
      'body.currentPassword',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  base: {
    env: env.NODE_ENV,
  },
});

export type Logger = typeof logger;
