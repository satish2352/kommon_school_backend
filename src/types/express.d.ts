import { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      // Injected by auth middleware
      user?: {
        id: string;
        email: string;
        role: UserRole;
        tenantId: string | null;
      };
      // Injected by tenant resolver middleware
      tenant?: {
        id: string;
        slug: string;
        name: string;
        status: string;
      };
      // Injected by request context middleware
      requestId?: string;
    }
  }
}

export {};
