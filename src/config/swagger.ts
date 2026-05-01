import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Kommon School — Multi-Tenant SaaS API',
      version: '1.0.0',
      description: `
Production-ready multi-tenant school management SaaS API.

## Authentication
Use **Bearer token** authentication. Obtain tokens via \`POST /api/v1/auth/login\`.

## Multi-Tenancy
Include \`X-Tenant-Id\` header (or use subdomain routing) to scope requests to a school tenant.
Super admins can omit this header.

## Rate Limiting
- Global: 1000 req / 15 min per IP
- Auth endpoints: 20 req / 15 min per IP
- Sensitive endpoints: 5 req / hour per IP
      `,
      contact: {
        name: 'Kommon School Team',
        email: 'api@kommon.school',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: `http://localhost:${env.PORT}/api/${env.API_VERSION}`,
        description: 'Development server',
      },
      {
        url: `https://api.kommon.school/api/${env.API_VERSION}`,
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token obtained from login endpoint',
        },
      },
      schemas: {
        ApiResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: { type: 'object', nullable: true },
            meta: {
              type: 'object',
              nullable: true,
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                totalPages: { type: 'integer' },
              },
            },
          },
        },
        ApiError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string' },
                details: { type: 'array', items: { type: 'object' }, nullable: true },
              },
            },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 100 },
            totalPages: { type: 'integer', example: 5 },
            hasNextPage: { type: 'boolean' },
            hasPrevPage: { type: 'boolean' },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Unauthorized — missing or invalid token',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
        Forbidden: {
          description: 'Forbidden — insufficient permissions',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
        TooManyRequests: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
        ValidationError: {
          description: 'Request validation failed',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Health', description: 'Liveness, readiness, and metrics endpoints' },
      { name: 'Auth', description: 'Authentication — register, login, refresh, logout' },
      { name: 'Users', description: 'User management' },
      { name: 'Tenants', description: 'Tenant (school) management — super admin only' },
      { name: 'Students', description: 'Student records management' },
    ],
  },
  apis: ['./src/modules/**/*.ts', './src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
