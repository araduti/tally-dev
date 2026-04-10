import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from './db';

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    organization(),
  ],
});

export type Session = typeof auth.$Infer.Session;
