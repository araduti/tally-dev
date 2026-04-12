import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/routers';
import { createContext } from '@/server/trpc/context';
import { handleTRPCError } from '@/server/trpc/init';
import { captureException } from '@/lib/sentry';
import { logger } from '@/lib/logger';

// Prevent Next.js from pre-rendering this route at build time,
// which would fail because PrismaClient requires DATABASE_URL.
export const dynamic = 'force-dynamic';

const handler = async (req: Request) => {
  try {
    return await fetchRequestHandler({
      endpoint: '/api/trpc',
      req,
      router: appRouter,
      createContext: ({ req, resHeaders }) => createContext({ req, resHeaders }),
      onError({ error, path, ctx }) {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          logger.error(`tRPC error on ${path}:`, { error: error.message });
        }
        handleTRPCError({ error, path, ctx });
      },
    });
  } catch (unhandledError: unknown) {
    // Catch truly unhandled errors that escape tRPC's error boundary
    captureException(unhandledError, {
      tags: { source: 'trpc-route-handler' },
    });
    logger.error('Unhandled error in tRPC route handler', {
      error: unhandledError instanceof Error ? unhandledError.message : String(unhandledError),
    });
    return new Response('Internal Server Error', { status: 500 });
  }
};

export { handler as GET, handler as POST };
