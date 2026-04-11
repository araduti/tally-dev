import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/routers';
import { createContext } from '@/server/trpc/context';

// Prevent Next.js from pre-rendering this route at build time,
// which would fail because PrismaClient requires DATABASE_URL.
export const dynamic = 'force-dynamic';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: ({ req, resHeaders }) => createContext({ req, resHeaders }),
    onError({ error, path }) {
      if (error.code === 'INTERNAL_SERVER_ERROR') {
        console.error(`tRPC error on ${path}:`, error.message);
      }
    },
  });

export { handler as GET, handler as POST };
