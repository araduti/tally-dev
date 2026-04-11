import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { inngestFunctions } from '@/inngest';

// Prevent Next.js from pre-rendering this route at build time,
// which would fail because PrismaClient requires DATABASE_URL.
export const dynamic = 'force-dynamic';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
