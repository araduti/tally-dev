/**
 * Unit tests for src/lib/email.ts — Lettermint email client.
 */

// ── Mocks ──────────────────────────────────────────────────────────

// Mock the sentry module before importing the module under test
vi.mock('@/lib/sentry', () => ({
  captureException: vi.fn(),
}));

import { sendEmail, sendVerificationEmail, sendInvitationEmail } from '../email';
import { captureException } from '@/lib/sentry';

// ── Helpers ────────────────────────────────────────────────────────

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  // Save and reset relevant env vars
  for (const key of ['LETTERMINT_API_KEY', 'LETTERMINT_FROM_EMAIL', 'LETTERMINT_API_URL', 'NODE_ENV']) {
    savedEnv[key] = process.env[key];
  }
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  // Restore env vars
  setEnv(savedEnv);
});

// ── Tests ──────────────────────────────────────────────────────────

describe('sendEmail', () => {
  it('logs to console when LETTERMINT_API_KEY is not set', async () => {
    setEnv({ LETTERMINT_API_KEY: undefined });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail({
      to: 'test@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('test@example.com'),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends email via Lettermint API when configured', async () => {
    setEnv({
      LETTERMINT_API_KEY: 'lm_test_key_123',
      LETTERMINT_FROM_EMAIL: 'noreply@acme.com',
      LETTERMINT_API_URL: 'https://api.lettermint.test',
    });

    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg_123' }),
    });

    await sendEmail({
      to: 'user@example.com',
      subject: 'Test Subject',
      html: '<p>Body</p>',
      text: 'Body',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.lettermint.test/v1/email/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer lm_test_key_123',
          'Content-Type': 'application/json',
        }),
      }),
    );

    // Verify the body includes correct fields
    const call = (fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.from).toBe('noreply@acme.com');
    expect(body.to).toBe('user@example.com');
    expect(body.subject).toBe('Test Subject');
    expect(body.html).toBe('<p>Body</p>');
    expect(body.text).toBe('Body');
  });

  it('uses default API URL when LETTERMINT_API_URL is not set', async () => {
    setEnv({
      LETTERMINT_API_KEY: 'lm_key',
      LETTERMINT_API_URL: undefined,
    });

    (fetch as any).mockResolvedValue({ ok: true });

    await sendEmail({ to: 'a@b.com', subject: 's', html: '<p>b</p>' });

    const url = (fetch as any).mock.calls[0][0];
    expect(url).toBe('https://api.lettermint.email/v1/email/send');
  });

  it('throws and reports to Sentry on API error', async () => {
    setEnv({ LETTERMINT_API_KEY: 'lm_key' });

    (fetch as any).mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: async () => '{"error":"invalid email"}',
    });

    await expect(
      sendEmail({ to: 'bad', subject: 's', html: '<p>b</p>' }),
    ).rejects.toThrow('Lettermint API error');

    expect(captureException).toHaveBeenCalled();
  });

  it('omits text field when not provided', async () => {
    setEnv({ LETTERMINT_API_KEY: 'lm_key' });
    (fetch as any).mockResolvedValue({ ok: true });

    await sendEmail({ to: 'a@b.com', subject: 's', html: '<p>h</p>' });

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.text).toBeUndefined();
  });
});

describe('sendVerificationEmail', () => {
  it('sends a verification email with correct subject and content', async () => {
    setEnv({ LETTERMINT_API_KEY: 'lm_key' });
    (fetch as any).mockResolvedValue({ ok: true });

    await sendVerificationEmail('user@test.com', 'https://app.tally.dev/verify?token=abc');

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.to).toBe('user@test.com');
    expect(body.subject).toBe('Verify your email address');
    expect(body.html).toContain('Verify Email');
    expect(body.html).toContain('https://app.tally.dev/verify?token=abc');
    expect(body.text).toContain('https://app.tally.dev/verify?token=abc');
  });

  it('escapes HTML in the URL', async () => {
    setEnv({ LETTERMINT_API_KEY: 'lm_key' });
    (fetch as any).mockResolvedValue({ ok: true });

    await sendVerificationEmail('u@t.com', 'https://example.com?a=1&b=<script>');

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&amp;');
  });
});

describe('sendInvitationEmail', () => {
  it('sends an invitation email with org name and inviter', async () => {
    setEnv({ LETTERMINT_API_KEY: 'lm_key' });
    (fetch as any).mockResolvedValue({ ok: true });

    await sendInvitationEmail(
      'new@user.com',
      'Acme Corp',
      'Jane Doe',
      'https://tally.dev/invite/abc',
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.to).toBe('new@user.com');
    expect(body.subject).toContain('Acme Corp');
    expect(body.html).toContain('Jane Doe');
    expect(body.html).toContain('Accept Invitation');
    expect(body.html).toContain('7 days');
  });

  it('escapes HTML in organization name and inviter name', async () => {
    setEnv({ LETTERMINT_API_KEY: 'lm_key' });
    (fetch as any).mockResolvedValue({ ok: true });

    await sendInvitationEmail(
      'u@t.com',
      '<script>alert("xss")</script>',
      'Eve<img src=x>',
      'https://tally.dev/invite/abc',
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.html).not.toContain('<script>');
    expect(body.html).not.toContain('<img');
    expect(body.html).toContain('&lt;script&gt;');
  });
});
