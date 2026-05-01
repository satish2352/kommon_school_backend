import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

export interface RequestContext {
  requestId: string;
  userId?: string;
  tenantId?: string;
  role?: string;
  ip?: string;
  path?: string;
  startTime: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(partial: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: partial.requestId ?? uuidv4(),
    startTime: partial.startTime ?? Date.now(),
    ...partial,
  };
}

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string {
  return storage.getStore()?.requestId ?? 'no-context';
}
