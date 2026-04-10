import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'schema.prisma'),
  migrate: {
    async resolveUrl() {
      return process.env.DATABASE_URL ?? 'postgresql://tally:tally@localhost:5432/tally';
    },
  },
});
