/**
 * Referral-success email — sent to the REFERRER when a friend redeems
 * their personal coupon code.
 *
 * Tone: warm, brief, celebratory but not gushing. The referrer just
 * earned something real (a free month of premium); the email confirms
 * it without making them feel like they're being marketed at.
 *
 * No-tracking design: we deliberately don't include UTM params on the
 * dashboard CTA. The user's already a customer; tracking their click
 * patterns from a thank-you email is creepy.
 *
 * Personalisation:
 *   - referrerName: first name only
 *   - friendName: first name only (if available); otherwise "your friend"
 *   - monthsCredited: number of premium months added (typically 1)
 */

import { sendEmail } from '@/lib/email';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://effortos-zeta.vercel.app';

interface ReferralSuccessParams {
  toEmail: string;
  referrerName: string;
  friendName: string | null;
  monthsCredited: number;
}

export async function sendReferralSuccessEmail(params: ReferralSuccessParams): Promise<void> {
  const { toEmail, referrerName, friendName, monthsCredited } = params;

  const firstName = referrerName.split(' ')[0] || 'there';
  const friendDisplay = (friendName && friendName.trim().split(' ')[0]) || 'A friend';
  const monthLabel = monthsCredited === 1 ? '1 month' : `${monthsCredited} months`;

  const subject = `${friendDisplay} just joined — you got ${monthLabel} free`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0B0F14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e5e7eb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F14;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#11161E;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 16px;">
              <div style="display:inline-block;width:44px;height:44px;border-radius:12px;background:#0F141B;border:2px solid rgba(34,211,238,0.4);text-align:center;line-height:40px;font-size:24px;font-weight:800;color:#22d3ee;letter-spacing:-1px;">E</div>
              <p style="margin:14px 0 0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#22d3ee;font-weight:600;">Referral activated</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 8px;">
              <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                ${friendDisplay} just joined EffortOS
              </h1>
              <p style="margin:12px 0 0;font-size:14px;color:rgba(255,255,255,0.6);line-height:1.6;">
                Hi ${firstName} — your referral code worked. ${friendDisplay} signed up
                and you both got <strong style="color:#22d3ee;">${monthLabel} free</strong>
                of EffortOS premium added to your account.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px;">
              <div style="background:rgba(34,211,238,0.06);border:1px solid rgba(34,211,238,0.20);border-radius:12px;padding:16px 18px;">
                <p style="margin:0;font-size:13px;color:#22d3ee;font-weight:600;">
                  ✨ ${monthLabel} of premium added to your account
                </p>
                <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.5);">
                  No action needed — your subscription period is already extended.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 0;">
              <a href="${APP_URL}" style="display:inline-block;background:#22d3ee;color:#0B0F14;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;">
                Open EffortOS →
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px;">
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.45);line-height:1.6;">
                Want to invite more friends? Each one earns you (and them) another month
                free, up to 10 friends. Your code is in
                <a href="${APP_URL}" style="color:#22d3ee;text-decoration:none;">Settings → Invite Friends</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;">
              <hr style="border:0;border-top:1px solid rgba(255,255,255,0.06);margin:0;" />
              <p style="margin:16px 0 0;font-size:10px;color:rgba(255,255,255,0.30);line-height:1.5;">
                Sent because you have an active EffortOS referral code. This is a
                transactional notification about your subscription and isn't part of
                marketing — you'll receive these automatically when a referral lands.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Transactional flag — referral payout is a subscription-balance
  // notification, not marketing. Skips the unsubscribe headers.
  await sendEmail({
    to: toEmail,
    subject,
    html,
    transactional: true,
    tags: [{ name: 'kind', value: 'referral_success' }],
  });
}
