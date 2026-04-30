/**
 * Coverage for src/lib/email.ts.
 *
 * The pre-launch fix to email plumbing was: replace the literal `{{email}}`
 * placeholder Resend never substituted with a real per-recipient injection,
 * and add an RFC 8058 List-Unsubscribe-Post header so Gmail/Apple's one-click
 * unsubscribe shows up. These tests pin the four guarantees that came out of
 * that fix:
 *
 *   1. **{{email}} is replaced with the URL-encoded recipient.** Otherwise
 *      every recipient gets a broken unsubscribe link.
 *   2. **List-Unsubscribe + List-Unsubscribe-Post: One-Click are set on
 *      lifecycle emails.** Required by Gmail/Apple to render the one-click
 *      unsubscribe affordance.
 *   3. **Transactional emails skip List-Unsubscribe.** A user who unsubbed
 *      from marketing must still receive billing/security receipts.
 *   4. **Multi-recipient calls to sendEmail throw.** Per-recipient injection
 *      and headers can't be honoured for an array; sendBulkEmail must be
 *      used for fan-out.
 *
 * We mock the Resend SDK so the test never makes a network call; the mock
 * captures the payload Resend would have sent and lets each test inspect it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Resend SDK ──────────────────────────────────────────────────

interface CapturedSend {
  from: string;
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
}

const captured: { single: CapturedSend[]; batches: CapturedSend[][] } = {
  single: [],
  batches: [],
};

vi.mock('resend', () => {
  return {
    Resend: class {
      emails = {
        send: async (payload: CapturedSend) => {
          captured.single.push(payload);
          return { data: { id: `email_${captured.single.length}` }, error: null };
        },
      };
      batch = {
        send: async (payloads: CapturedSend[]) => {
          captured.batches.push(payloads);
          return { data: { ids: payloads.map((_, i) => `b_${i}`) }, error: null };
        },
      };
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test_resend_key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://effortos.com';
  process.env.EMAIL_FROM = 'EffortOS <hi@effortos.com>';
  process.env.EMAIL_REPLY_TO = 'replies@effortos.com';
  captured.single.length = 0;
  captured.batches.length = 0;
});

async function freshEmailModule() {
  vi.resetModules();
  return await import('@/lib/email');
}

const TEMPLATE = `<p>Hello.</p>
<a href="https://effortos.com/unsubscribe?email={{email}}">Unsubscribe</a>`;

// ── Tests ────────────────────────────────────────────────────────────

describe('lib/email — sendEmail', () => {
  it('replaces {{email}} with the URL-encoded recipient', async () => {
    const { sendEmail } = await freshEmailModule();
    await sendEmail({
      to: 'aanya+test@example.com',
      subject: 'hi',
      html: TEMPLATE,
    });
    expect(captured.single).toHaveLength(1);
    const sent = captured.single[0];
    // `+` in the local-part must be percent-encoded so it survives query
    // parsers on the unsubscribe page.
    expect(sent.html).toContain('aanya%2Btest%40example.com');
    expect(sent.html).not.toContain('{{email}}');
    expect(sent.to).toEqual(['aanya+test@example.com']);
  });

  it('sets List-Unsubscribe and List-Unsubscribe-Post on lifecycle emails', async () => {
    const { sendEmail } = await freshEmailModule();
    await sendEmail({
      to: 'user@example.com',
      subject: 'lifecycle',
      html: '<p>Marketing.</p>',
      // transactional unset (default) → headers should be present
    });
    const sent = captured.single[0];
    expect(sent.headers).toBeDefined();
    // The header now points at the signed-token endpoint instead of a
    // bare-email query string — see lib/unsubscribe-token.ts and the
    // Day-1 audit fix that closed the cross-user-unsubscribe vulnerability.
    // The token itself varies per call (HMAC of email|exp), so we assert
    // shape: the URL prefix + query-key, and the mailto fallback.
    const listUnsub = sent.headers!['List-Unsubscribe'];
    expect(listUnsub).toContain('https://effortos.com/api/unsubscribe?t=');
    expect(listUnsub).toContain('<mailto:unsubscribe@effortos.com?subject=unsubscribe>');
    // RFC 8058 — required for Gmail/Apple one-click unsubscribe.
    expect(sent.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('OMITS List-Unsubscribe headers on transactional emails', async () => {
    const { sendEmail } = await freshEmailModule();
    await sendEmail({
      to: 'user@example.com',
      subject: 'Payment failed — action required',
      html: '<p>Update your card.</p>',
      transactional: true,
    });
    const sent = captured.single[0];
    // Critical: a user who unsubbed from marketing must still receive
    // billing/security receipts.
    expect(sent.headers).toBeUndefined();
  });

  it('throws when called with an array of recipients', async () => {
    const { sendEmail } = await freshEmailModule();
    await expect(
      sendEmail({
        to: ['a@example.com', 'b@example.com'],
        subject: 'broadcast',
        html: '<p>oops</p>',
      }),
    ).rejects.toThrow(/sendBulkEmail/);
  });

  it('throws when called with an empty array', async () => {
    const { sendEmail } = await freshEmailModule();
    await expect(
      sendEmail({
        to: [] as unknown as string,
        subject: 'broadcast',
        html: '<p>oops</p>',
      }),
    ).rejects.toThrow(/exactly one recipient/);
  });

  it('uses the configured replyTo by default', async () => {
    const { sendEmail } = await freshEmailModule();
    await sendEmail({ to: 'a@example.com', subject: 's', html: '<p>x</p>' });
    expect(captured.single[0].replyTo).toBe('replies@effortos.com');
  });

  it('respects per-call replyTo override', async () => {
    const { sendEmail } = await freshEmailModule();
    await sendEmail({
      to: 'a@example.com',
      subject: 's',
      html: '<p>x</p>',
      replyTo: 'override@effortos.com',
    });
    expect(captured.single[0].replyTo).toBe('override@effortos.com');
  });
});

describe('lib/email — sendBulkEmail', () => {
  it('injects per-recipient {{email}} in each batched message', async () => {
    const { sendBulkEmail } = await freshEmailModule();
    const recipients = ['one@example.com', 'two@example.com'];
    const sent = await sendBulkEmail(
      recipients,
      'weekly digest',
      () => TEMPLATE,
    );
    expect(sent).toBe(2);
    expect(captured.batches).toHaveLength(1);
    const batch = captured.batches[0];
    expect(batch[0].html).toContain('one%40example.com');
    expect(batch[1].html).toContain('two%40example.com');
    // No batch should contain a literal placeholder.
    for (const msg of batch) {
      expect(msg.html).not.toContain('{{email}}');
    }
  });

  it('omits unsubscribe headers when bulk send is marked transactional', async () => {
    const { sendBulkEmail } = await freshEmailModule();
    await sendBulkEmail(
      ['a@example.com'],
      'service notice',
      () => '<p>important</p>',
      undefined,
      { transactional: true },
    );
    const batch = captured.batches[0];
    expect(batch[0].headers).toBeUndefined();
  });

  it('chunks recipients into 50-per-batch when over the limit', async () => {
    const { sendBulkEmail } = await freshEmailModule();
    const recipients = Array.from({ length: 75 }, (_, i) => `u${i}@example.com`);
    const sent = await sendBulkEmail(recipients, 's', () => '<p>x</p>');
    expect(sent).toBe(75);
    // Resend max is 50 per batch, so 75 → 2 batches (50, 25).
    expect(captured.batches).toHaveLength(2);
    expect(captured.batches[0]).toHaveLength(50);
    expect(captured.batches[1]).toHaveLength(25);
  });
});
