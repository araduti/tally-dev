import 'server-only';
import { createCallerFactory } from '@/server/trpc/init';
import { appRouter } from '@/server/routers';
import { createContext } from '@/server/trpc/context';
import { headers, cookies } from 'next/headers';

const createCaller = createCallerFactory(appRouter);

/**
 * Server-side tRPC caller for use in React Server Components.
 * This bypasses HTTP and calls procedures directly.
 *
 * Forwards the real session cookie so the auth middleware can
 * resolve the user, org, and RLS proxy — identical to an HTTP request.
 */
export const api = createCaller(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const host = headerStore.get('x-forwarded-host');
  const proto = headerStore.get('x-forwarded-proto') ?? 'http';
  const baseUrl = host ? `${proto}://${host}` : 'http://localhost:3000';

  const req = new Request(baseUrl, {
    headers: {
      cookie: cookieStore.toString(),
    },
  });

  return createContext({ req, resHeaders: new Headers() });
});
