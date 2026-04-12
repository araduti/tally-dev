/**
 * Lettermint transactional email client.
 *
 * Wraps the Lettermint HTTP API to send verification, password-reset,
 * and invitation emails.  Fire-and-forget by default — callers should
 * catch errors and log / report rather than letting them bubble.
 *
 * Environment variables:
 *   LETTERMINT_API_KEY     – API key for the Lettermint service
 *   LETTERMINT_FROM_EMAIL  – Sender address (e.g. "noreply@example.com")
 *   LETTERMINT_API_URL     – Base URL (defaults to https://api.lettermint.email)
 */

import { captureException } from '@/lib/sentry';

// ── Types ──────────────────────────────────────────────────────────

export interface EmailPayload {
  /** Recipient email address. */
  to: string;
  /** Email subject line. */
  subject: string;
  /** HTML body. */
  html: string;
  /** Optional plain-text fallback. */
  text?: string;
}

interface LettermintResponse {
  id?: string;
  error?: string;
}

// ── Configuration ──────────────────────────────────────────────────

function getConfig() {
  const apiKey = process.env.LETTERMINT_API_KEY;
  const from = process.env.LETTERMINT_FROM_EMAIL ?? 'noreply@tally.app';
  const apiUrl = process.env.LETTERMINT_API_URL ?? 'https://api.lettermint.email';

  if (!apiKey) {
    return null; // Lettermint not configured — fall back to console logging
  }

  return { apiKey, from, apiUrl } as const;
}

// ── Core Send ──────────────────────────────────────────────────────

/**
 * Send a transactional email via Lettermint.
 *
 * When `LETTERMINT_API_KEY` is not set the function logs to console
 * and returns gracefully — this allows local dev without a mail
 * provider.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const config = getConfig();

  if (!config) {
    // Dev fallback — no Lettermint credentials configured
    console.log(
      `[Email] (dev) to=${payload.to} subject="${payload.subject}"`,
    );
    return;
  }

  const body = JSON.stringify({
    from: config.from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    ...(payload.text ? { text: payload.text } : {}),
  });

  const res = await fetch(`${config.apiUrl}/v1/email/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(10_000), // 10 s timeout
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    const err = new Error(
      `Lettermint API error: ${res.status} ${res.statusText} – ${text}`,
    );
    captureException(err);
    throw err;
  }
}

// ── Template Helpers ───────────────────────────────────────────────

/**
 * Send an email-verification link.
 */
export async function sendVerificationEmail(
  email: string,
  url: string,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Verify your email address',
    html: `
      <p>Welcome to Tally!</p>
      <p>Please verify your email address by clicking the link below:</p>
      <p><a href="${escapeHtml(url)}">Verify Email</a></p>
      <p>If you didn't create an account, you can safely ignore this email.</p>
    `.trim(),
    text: `Welcome to Tally!\n\nVerify your email: ${url}\n\nIf you didn't create an account, you can safely ignore this email.`,
  });
}

/**
 * Send an organization-invitation email.
 */
export async function sendInvitationEmail(
  email: string,
  organizationName: string,
  inviterName: string,
  acceptUrl: string,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `You've been invited to ${organizationName} on Tally`,
    html: `
      <p>${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(organizationName)}</strong> on Tally.</p>
      <p><a href="${escapeHtml(acceptUrl)}">Accept Invitation</a></p>
      <p>This invitation expires in 7 days.</p>
    `.trim(),
    text: `${inviterName} has invited you to join ${organizationName} on Tally.\n\nAccept: ${acceptUrl}\n\nThis invitation expires in 7 days.`,
  });
}

// ── Utilities ──────────────────────────────────────────────────────

/** Minimal HTML entity escaping for user-supplied values. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
