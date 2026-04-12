import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from './db';
import { sendVerificationEmail } from './email';

/**
 * Checks whether an OAuth provider is fully configured by verifying
 * that both client ID and secret environment variables are set.
 */
function isProviderConfigured(clientId?: string, clientSecret?: string): boolean {
  return Boolean(clientId && clientId.length > 0 && clientSecret && clientSecret.length > 0);
}

const googleEnabled = isProviderConfigured(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);

const microsoftEnabled = isProviderConfigured(
  process.env.MICROSOFT_CLIENT_ID,
  process.env.MICROSOFT_CLIENT_SECRET,
);

// Build social providers array conditionally — only include providers with configured credentials
const socialProviders: Parameters<typeof betterAuth>[0]['socialProviders'] = {};

if (googleEnabled) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  };
}

if (microsoftEnabled) {
  socialProviders.microsoft = {
    clientId: process.env.MICROSOFT_CLIENT_ID!,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
  };
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Email Verification] Send to ${user.email}: ${url}`);
      }
      await sendVerificationEmail(user.email, url);
    },
    sendOnSignUp: true,
  },
  socialProviders,
  plugins: [
    organization(),
  ],
});

/**
 * Runtime flags for the client to know which OAuth providers are available.
 * Exposed via a lightweight API route — never leak client secrets.
 */
export const enabledProviders = {
  google: googleEnabled,
  microsoft: microsoftEnabled,
} as const;

export type Session = typeof auth.$Infer.Session;
