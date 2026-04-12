import { z } from 'zod';

/**
 * Runtime environment variable validation.
 *
 * Import this module at application startup to ensure all required
 * environment variables are present and correctly shaped. Missing or
 * invalid values will cause an immediate, descriptive error rather than
 * a cryptic failure at an arbitrary point later.
 */

const envSchema = z.object({
  // ── Database ──
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a PostgreSQL connection string'),

  // ── Redis ──
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required'),

  // ── Garage (S3-compatible storage) ──
  GARAGE_ENDPOINT: z.string().min(1, 'GARAGE_ENDPOINT is required'),
  GARAGE_ACCESS_KEY: z.string().min(1, 'GARAGE_ACCESS_KEY is required'),
  GARAGE_SECRET_KEY: z.string().min(1, 'GARAGE_SECRET_KEY is required'),

  // ── Encryption ──
  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
    .regex(/^[0-9a-fA-F]+$/, 'ENCRYPTION_KEY must be valid hexadecimal'),

  // ── Auth ──
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be a valid URL'),

  // ── Inngest ──
  INNGEST_EVENT_KEY: z.string().min(1, 'INNGEST_EVENT_KEY is required'),
  INNGEST_SIGNING_KEY: z.string().min(1, 'INNGEST_SIGNING_KEY is required'),

  // ── Lettermint (transactional email — optional in dev, required in production) ──
  LETTERMINT_API_KEY: z.string().min(1).optional(),
  LETTERMINT_FROM_EMAIL: z.string().email().optional(),
  LETTERMINT_API_URL: z.string().url().optional(),

  // ── Optional ──
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // ── Error Tracking (optional — Sentry) ──
  SENTRY_DSN: z.string().url('SENTRY_DSN must be a valid URL').optional(),
  SENTRY_ENVIRONMENT: z.string().min(1).optional(),

  // ── OAuth / SSO (optional — only needed if enabling social login) ──
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),

  // ── Stripe (optional — only needed for DIRECT_STRIPE billing) ──
  STRIPE_SECRET_KEY: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('sk_'), { message: 'STRIPE_SECRET_KEY must start with "sk_"' })
    .optional(),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('whsec_'), { message: 'STRIPE_WEBHOOK_SECRET must start with "whsec_"' })
    .optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('pk_'), { message: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must start with "pk_"' })
    .optional(),
}).superRefine((data, ctx) => {
  // Ensure that if one half of an OAuth provider is set, the other half is too.
  if (data.GOOGLE_CLIENT_ID && !data.GOOGLE_CLIENT_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['GOOGLE_CLIENT_SECRET'],
      message: 'GOOGLE_CLIENT_SECRET is required when GOOGLE_CLIENT_ID is set',
    });
  }
  if (!data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['GOOGLE_CLIENT_ID'],
      message: 'GOOGLE_CLIENT_ID is required when GOOGLE_CLIENT_SECRET is set',
    });
  }
  if (data.MICROSOFT_CLIENT_ID && !data.MICROSOFT_CLIENT_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MICROSOFT_CLIENT_SECRET'],
      message: 'MICROSOFT_CLIENT_SECRET is required when MICROSOFT_CLIENT_ID is set',
    });
  }
  if (!data.MICROSOFT_CLIENT_ID && data.MICROSOFT_CLIENT_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MICROSOFT_CLIENT_ID'],
      message: 'MICROSOFT_CLIENT_ID is required when MICROSOFT_CLIENT_SECRET is set',
    });
  }

  // Stripe: if any Stripe variable is set, all three must be set.
  const stripeVars = [
    data.STRIPE_SECRET_KEY,
    data.STRIPE_WEBHOOK_SECRET,
    data.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  ];
  const stripeSet = stripeVars.filter(Boolean).length;
  if (stripeSet > 0 && stripeSet < 3) {
    const stripeKeys = [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    ] as const;
    for (const key of stripeKeys) {
      if (!data[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when any Stripe variable is set`,
        });
      }
    }
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates environment variables and returns the parsed result.
 * Call this at application startup (e.g. in instrumentation.ts or a
 * top-level server module).
 *
 * @throws {Error} with descriptive messages for all validation failures
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `❌ Environment validation failed:\n${formatted}\n\n` +
      'Copy .env.example to .env and fill in the required values.',
    );
  }

  return result.data;
}
