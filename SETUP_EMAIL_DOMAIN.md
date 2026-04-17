# Email domain setup (Resend + your registered domain)

This is a one-time setup so EffortOS can send from `hello@yourdomain.com`
instead of `onboarding@resend.dev`. Once complete:

- Inbox placement improves dramatically (the resend.dev sender is heavily
  filtered by Gmail, Outlook, corporate mail servers).
- You unlock DKIM + SPF signing, which is mandatory for transactional mail
  going to `@gmail.com` / `@yahoo.com` addresses in 2024+.
- Unsubscribe-link compliance (RFC 8058) starts working properly because the
  From domain matches the signing domain.

Budget: 20 minutes now + up to 24h DNS propagation. All DNS changes are
non-destructive — you can remove them any time with zero impact on your
main site.

---

## 1. Add the domain in Resend

1. Open https://resend.com/domains and click **Add Domain**.
2. Enter your registered domain. Pick a **sending subdomain** — either:
   - `send.yourdomain.com` (recommended: isolates sending reputation), or
   - `yourdomain.com` (simpler, fine if you don't plan to send from a
     marketing platform later).
3. Choose **region** closest to your users. `Asia Pacific (Mumbai)` is the
   right call for EffortOS since your user base is India-leaning.
4. Resend will show you a DNS record table. **Leave this tab open** —
   you'll paste each row into your registrar in the next step.

## 2. Add the DNS records at your registrar

Resend will give you four records. Add each to your registrar's DNS editor
(Namecheap, GoDaddy, Cloudflare, Route 53 — all work the same way).

A typical set looks like this (yours will have different tokens):

| Type  | Host / Name                              | Value                                                           | TTL  |
| ----- | ---------------------------------------- | --------------------------------------------------------------- | ---- |
| MX    | `send`                                   | `feedback-smtp.ap-south-1.amazonses.com` · priority 10          | Auto |
| TXT   | `send`                                   | `v=spf1 include:amazonses.com ~all`                             | Auto |
| TXT   | `resend._domainkey.send`                 | (long DKIM public key — paste exactly as shown)                 | Auto |
| TXT   | `_dmarc`                                 | `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com`             | Auto |

Notes:

- The `Host / Name` column is **relative** to your root domain at most
  registrars. If yours wants fully qualified names, append `.yourdomain.com`
  to each host.
- The DKIM value is long (~400 chars) and must be pasted exactly. Don't add
  line breaks. Cloudflare and Route 53 handle long TXT values natively;
  older registrars split it into 255-char chunks with quotes.
- The **DMARC** record starts in monitor mode (`p=none`) — you'll see
  reports but nothing is rejected. After 1–2 weeks of clean data, tighten to
  `p=quarantine` then `p=reject`.

## 3. Wait for verification

Resend polls DNS every few minutes. Typical times:

- Cloudflare: 2–5 minutes.
- Namecheap / GoDaddy: 15–60 minutes.
- Worst case: up to 24 hours. Don't panic before then.

When the domain shows **Verified** in Resend with all three checks (SPF,
DKIM, DMARC) green, you're ready to update the app.

## 4. Update EffortOS environment

In Vercel → Project settings → Environment variables, update (or add) these
values and redeploy:

```
EMAIL_FROM=EffortOS <hello@send.yourdomain.com>
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
```

Match `NEXT_PUBLIC_SITE_URL` to whatever your production URL will be — if
you're keeping `effortos-zeta.vercel.app` for now, leave it. Update it when
you point the root domain at Vercel.

Optional but recommended: also set a **reply-to** via Resend's dashboard so
replies land in a real inbox (e.g., `mudit@yourdomain.com`).

## 5. Test end-to-end

From the EffortOS admin panel (or by triggering any email flow):

1. Send yourself a welcome email (sign up with a test account).
2. Open the raw message in Gmail → **Show original**. Look for:
   - `SPF: PASS with IP …`
   - `DKIM: 'PASS' with domain send.yourdomain.com`
   - `DMARC: 'PASS'`
3. Check that the sender shows as `EffortOS <hello@send.yourdomain.com>`
   and Gmail **doesn't** warn "via resend.com".

If any of those fail, the most common cause is a TXT record pasted with
leading/trailing whitespace or split across multiple records — re-check
in Resend's DNS tab (it highlights which record is wrong).

## 6. Subscribe to DMARC reports (optional, 5 min)

You'll start receiving daily XML reports at `dmarc@yourdomain.com`. They're
unreadable raw, so route them through a free parser:

- https://postmarkapp.com/dmarc (free for small volume)
- https://dmarcian.com (free tier)

After two weeks of clean reports, tighten the DMARC policy:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com; pct=100
```

and eventually `p=reject`. This is what makes you bulletproof against
spoofing.

---

## Troubleshooting quickies

**Resend says domain "Verification failed" after 24h.**
Run `dig TXT resend._domainkey.send.yourdomain.com +short` — if it returns
nothing, the DKIM record didn't propagate. Re-paste from Resend.

**Welcome emails land in Spam.**
Likely still using the `onboarding@resend.dev` sender. Confirm
`EMAIL_FROM` is set in Vercel **and you redeployed** — env var changes
don't hot-reload.

**Gmail shows "via amazonses.com".**
That's Resend's SMTP provider and is normal on non-verified domains. Once
DKIM passes on your domain, Gmail stops showing it.

**Users on `@outlook.com` / corporate Exchange still see sender warnings.**
Expected with `p=none` DMARC. Tighten to `p=quarantine` once you're
confident no legit mail is failing auth.
