import 'server-only';
import { createCallerFactory } from '@/server/trpc/init';
import { appRouter } from '@/server/routers';
import { createContext } from '@/server/trpc/context';

const createCaller = createCallerFactory(appRouter);

/**
 * Server-side tRPC caller for use in React Server Components.
 * This bypasses HTTP and calls procedures directly.
 */
export const api = createCaller(() =>
  createContext({
    req: new Request('http://localhost:3000'),
    resHeaders: new Headers(),
  }),
);
