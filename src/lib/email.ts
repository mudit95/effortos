import { Resend } from 'resend';
import { signUnsubscribeToken } from './unsubscribe-token';

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY not configured');
    _resend = new Resend(key);
  }
  return _resend;
}

/** Verified sender — change once your domain is verified in Resend. */
export const FROM_EMAIL = process.env.EMAIL_FROM || 'EffortOS <onboarding@resend.dev>';

/**
 * Default reply-to. We funnel replies to a real inbox so users who actually hit
 * "Reply" on the welcome email don't get a no-reply bounce. Override per-call
 * via SendEmailOpts.replyTo.
 */
export const REPLY_TO = process.env.EMAIL_REPLY_TO || 'hello@effortos.com';

/** Base URL for links in emails. */
export const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://effortos.vercel.app';

// ── Send helpers ──────────────────────────────────────────────────

export interface SendEmailOpts {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
  /**
   * Whether this is a transactional email (account/billing/security). Skips
   * the List-Unsubscribe header so users can't accidentally suppress critical
   * receipts. Defaults to false (i.e. marketing/lifecycle, gets List-Unsubscribe).
   */
  transactional?: boolean;
}

/**
 * Resolve placeholders in HTML at send time:
 *   {{email}}            → the recipient address (URL-encoded)
 *   {{unsubscribe_url}}  → /unsubscribe?t=<HMAC-signed token>
 *
 * We sign the unsubscribe target so an attacker can't iterate through other
 * users' addresses to silently unsubscribe them. The legacy `{{email}}`
 * substitution is still expanded for any embedded copy that uses it.
 */
function injectRecipient(html: string, recipient: string): string {
  const encodedEmail = encodeURIComponent(recipient);
  const token = signUnsubscribeToken(recipient);
  const unsubscribeUrl = `${APP_URL}/unsubscribe?t=${token}`;
  return html
    .split('{{unsubscribe_url}}').join(unsubscribeUrl)
    .split('{{email}}').join(encodedEmail);
}

function unsubscribeHeaders(recipient: string) {
  // RFC 8058 one-click unsubscribe: Gmail/Apple Mail can POST to this URL
  // and expect 2xx without interactive UI. The signed token in `?t=` is
  // what authenticates the action.
  const token = signUnsubscribeToken(recipient);
  const url = `${APP_URL}/api/unsubscribe?t=${token}`;
  return {
    'List-Unsubscribe': `<${url}>, <mailto:unsubscribe@effortos.com?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export async function sendEmail(opts: SendEmailOpts) {
  const resend = getResend();
  // Single-recipient path. Per-address List-Unsubscribe headers and {{email}}
  // substitution rely on knowing exactly who the recipient is, so we collapse
  // string-or-string[] down to a single address. Callers with many recipients
  // should use sendBulkEmail directly — accidentally passing an array here
  // would silently strip per-recipient personalisation.
  const recipients = Array.isArray(opts.to) ? opts.to : [opts.to];
  if (recipients.length !== 1) {
    throw new Error(
      `sendEmail requires exactly one recipient; got ${recipients.length}. Use sendBulkEmail for many.`,
    );
  }
  const recipient = recipients[0];
  const html = injectRecipient(opts.html, recipient);
  const headers = opts.transactional ? undefined : unsubscribeHeaders(recipient);

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: [recipient],
    subject: opts.subject,
    html,
    replyTo: opts.replyTo || REPLY_TO,
    tags: opts.tags,
    headers,
  });

  if (error) {
    console.error('[email] Send failed:', error);
    throw new Error(error.message);
  }
  return data;
}

/**
 * Send to multiple recipients in batches (Resend max 50 per call).
 * Returns count of successfully sent.
 */
export async function sendBulkEmail(
  recipients: string[],
  subject: string,
  htmlFn: (email: string) => string,
  tags?: { name: string; value: string }[],
  opts?: { transactional?: boolean; replyTo?: string },
): Promise<number> {
  const resend = getResend();
  let sent = 0;
  const batchSize = 50;
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    const emails = batch.map(email => ({
      from: FROM_EMAIL,
      to: [email],
      subject,
      // Run injectRecipient even on per-call htmlFn output so callers don't
      // have to remember to expand {{email}} themselves.
      html: injectRecipient(htmlFn(email), email),
      replyTo: opts?.replyTo || REPLY_TO,
      tags,
      headers: opts?.transactional ? undefined : unsubscribeHeaders(email),
    }));
    try {
      await resend.batch.send(emails);
      sent += batch.length;
    } catch (err) {
      console.error(`[email] Batch ${i}-${i + batchSize} failed:`, err);
    }
  }
  return sent;
}

// ── HTML template wrapper ─────────────────────────────────────────

/**
 * Base layout for all EffortOS emails.
 * Dark theme matching the app aesthetic. Pass inner HTML as `body`.
 *
 * The `{{email}}` token in the unsubscribe link is replaced at send time by
 * sendEmail / sendBulkEmail. Don't pre-render it at template authoring time.
 */
export function emailLayout(body: string, opts?: { preheader?: string }): string {
  const preheader = opts?.preheader || '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EffortOS</title>
  <style>
    body { margin: 0; padding: 0; background: #0B0F14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 560px; margin: 0 auto; padding: 40px 24px; }
    .logo { font-size: 13px; font-weight: 700; color: #06b6d4; letter-spacing: 0.5px; margin-bottom: 28px; }
    h1 { color: #f1f5f9; font-size: 20px; font-weight: 600; margin: 0 0 12px; }
    h2 { color: #e2e8f0; font-size: 16px; font-weight: 600; margin: 24px 0 8px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 12px; }
    .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 16px; margin: 16px 0; }
    .stat { display: inline-block; text-align: center; margin-right: 24px; }
    .stat-value { font-size: 22px; font-weight: 700; color: #06b6d4; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .task { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); color: #cbd5e1; font-size: 13px; }
    .task:last-child { border-bottom: none; }
    .task-done { text-decoration: line-through; color: #475569; }
    .tag { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 9999px; background: rgba(6,182,212,0.15); color: #06b6d4; margin-left: 8px; }
    .btn { display: inline-block; background: #06b6d4; color: #0f172a; font-size: 14px; font-weight: 600; text-decoration: none; padding: 10px 24px; border-radius: 8px; margin: 16px 0; }
    .btn:hover { background: #22d3ee; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.06); }
    .footer p { font-size: 11px; color: #475569; }
    .footer a { color: #06b6d4; text-decoration: none; }
    .preheader { display: none; font-size: 1px; color: #0B0F14; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; }
  </style>
</head>
<body>
  <div class="preheader">${preheader}</div>
  <div class="container">
    <div class="logo">EFFORTOS</div>
    ${body}
    <div class="footer">
      <p>You received this because you have an EffortOS account. <a href="${APP_URL}/settings">Manage email preferences</a> or <a href="{{unsubscribe_url}}">unsubscribe</a>.</p>
    </div>
  </div>
</body>
</html>`;
}
