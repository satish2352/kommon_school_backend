import express, { Application } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import hpp from 'hpp';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '@/config/swagger';
import { env } from '@/config/env';
import { requestContextMiddleware } from '@/middlewares/requestContext.middleware';
import { requestLoggerMiddleware } from '@/middlewares/requestLogger.middleware';
import { tenantResolverMiddleware } from '@/middlewares/tenantResolver.middleware';
import { globalRateLimiter } from '@/middlewares/rateLimiter.middleware';
import { errorHandlerMiddleware, notFoundMiddleware } from '@/middlewares/errorHandler.middleware';
import { handleWebhook } from '@/modules/payments/payments.webhook';
import v1Router from '@/routes/v1';

export function loadExpress(app: Application): void {
  // ── Razorpay webhook — MUST be registered before JSON body parser ─────────
  // Uses express.raw() to preserve the raw body for HMAC verification.
  // Mounted at a stable, non-versioned path so Razorpay dashboard config
  // never needs to change across API version bumps.
  app.post(
    '/webhooks/razorpay',
    express.raw({ type: 'application/json', limit: '1mb' }),
    handleWebhook,
  );

  // ── Security headers ──────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    }),
  );

  // ── CORS ──────────────────────────────────────────────────
  const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS policy: origin ${origin} not allowed`));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Tenant-Id'],
      exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    }),
  );

  // ── Compression ───────────────────────────────────────────
  app.use(compression());

  // ── Body parsers ──────────────────────────────────────────
  app.use(express.json({ limit: env.BODY_SIZE_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.BODY_SIZE_LIMIT }));

  // ── HPP — HTTP Parameter Pollution protection ─────────────
  app.use(hpp());

  // ── Trust proxy (for accurate IP behind load balancer) ────
  app.set('trust proxy', 1);

  // ── Request context (correlation IDs) ────────────────────
  app.use(requestContextMiddleware);

  // ── Request logging ────────────────────────────────────────
  app.use(requestLoggerMiddleware);

  // ── Tenant resolution ─────────────────────────────────────
  app.use(tenantResolverMiddleware);

  // ── Global rate limiter ───────────────────────────────────
  app.use(globalRateLimiter);

  // ── Swagger UI ────────────────────────────────────────────
  if (env.SWAGGER_ENABLED) {
    app.use(
      '/api/docs',
      swaggerUi.serve,
      swaggerUi.setup(swaggerSpec, {
        explorer: true,
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'Kommon School API Docs',
        swaggerOptions: {
          persistAuthorization: true,
          displayRequestDuration: true,
          filter: true,
          tryItOutEnabled: true,
        },
      }),
    );

    // Raw OpenAPI spec endpoint
    app.get('/api/docs.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });
  }

  // ── Root landing endpoint ────────────────────────────────
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        name: 'Kommon School API',
        version: '1.0.0',
        environment: env.NODE_ENV,
        endpoints: {
          health: `/api/${env.API_VERSION}/health`,
          ready: `/api/${env.API_VERSION}/health/ready`,
          metrics: `/api/${env.API_VERSION}/health/metrics`,
          api: `/api/${env.API_VERSION}`,
          docs: env.SWAGGER_ENABLED ? '/api/docs' : null,
          openapi: env.SWAGGER_ENABLED ? '/api/docs.json' : null,
        },
      },
      message: 'Welcome to Kommon School API',
    });
  });

  // ── API Routes ────────────────────────────────────────────
  app.use(`/api/${env.API_VERSION}`, v1Router);

  // ── 404 handler ───────────────────────────────────────────
  app.use(notFoundMiddleware);

  // ── Centralized error handler ─────────────────────────────
  app.use(errorHandlerMiddleware);
}
