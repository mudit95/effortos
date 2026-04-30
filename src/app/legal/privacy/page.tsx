export const metadata = { title: 'Privacy Policy — EffortOS' };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-xs text-white/40">Last updated: April 30, 2026</p>

      <p>
        EffortOS (&quot;we&quot;, &quot;us&quot;) respects your privacy. This Privacy Policy explains what
        information we collect, how we use it, and the choices you have.
      </p>

      <h2>1. Information We Collect</h2>
      <p>We collect the following types of information:</p>
      <ul>
        <li><strong>Account information</strong>: email address and display name when you register</li>
        <li><strong>Productivity data</strong>: goals, tasks, focus sessions, and progress that you create inside the app</li>
        <li><strong>Billing information</strong>: processed by Razorpay; we never store full payment card numbers on our servers</li>
        <li><strong>Usage data</strong>: basic analytics such as feature usage and session counts to improve the product</li>
        <li><strong>Device data</strong>: browser type, operating system, and IP address for security and diagnostics</li>
      </ul>

      <h2>2. How We Use Your Information</h2>
      <ul>
        <li>To provide, operate, and improve the Service</li>
        <li>To personalize your experience and power AI coaching features</li>
        <li>To process payments and manage subscriptions</li>
        <li>To communicate with you about your account, trial status, and product updates</li>
        <li>To detect, prevent, and address fraud, abuse, or security issues</li>
      </ul>

      <h2>3. AI Processing</h2>
      <p>
        Certain features send summaries of your productivity data to AI providers for processing.
        Specifically:
      </p>
      <ul>
        <li>
          <strong>Anthropic (Claude)</strong> — generates AI coaching content, parses your
          WhatsApp messages into structured intents, and produces motivational/insight messages.
        </li>
        <li>
          <strong>Groq</strong> — transcribes voice notes you send via WhatsApp using OpenAI&apos;s
          Whisper model running on Groq&apos;s infrastructure.
        </li>
      </ul>
      <p>
        We do not send personally identifying information beyond what is necessary to generate a
        response, and we do not allow this data to be used to train third-party models.
      </p>

      <h2>4. Cookies and Local Storage</h2>
      <p>
        We use cookies and browser local storage to keep you signed in, remember your
        preferences, and cache your data for offline use. You can clear this data from your
        browser settings at any time.
      </p>

      <h2>5. How We Share Information (Subprocessors)</h2>
      <p>We do not sell your personal information. We share specific data with the following service providers (subprocessors), each of which is contractually bound to handle your data only for the purposes we direct:</p>
      <ul>
        <li><strong>Supabase</strong> (Singapore / global) — our managed Postgres database and authentication provider. Stores your account, profile, goals, tasks, sessions, and journal entries.</li>
        <li><strong>Razorpay</strong> (India) — payment processing for subscriptions. Receives your name, email, billing address, and card details directly from the Razorpay checkout (we never see full card numbers).</li>
        <li><strong>Anthropic</strong> (USA) — Claude API for AI coaching, intent parsing, and message generation. Receives task titles, goal descriptions, and recent session summaries during a request; does not retain or train on this data.</li>
        <li><strong>Resend</strong> (USA) — transactional and lifecycle email delivery. Receives your email address and the contents of any email we send you.</li>
        <li><strong>Meta (WhatsApp Cloud API)</strong> (USA / Ireland) — WhatsApp message delivery to and from the EffortOS bot. Receives your phone number (with your consent during linking) and message bodies.</li>
        <li><strong>Groq</strong> (USA) — Whisper-based voice-note transcription. Receives the raw audio of any voice note you send to the WhatsApp bot.</li>
        <li><strong>Sentry</strong> (USA) — application error monitoring. May receive your user ID, email, and stack traces of any client- or server-side error.</li>
        <li><strong>Upstash</strong> (USA / Singapore) — Redis-backed rate limiting and ephemeral state (e.g., WhatsApp pending-flow keys). Stores your user ID and short-lived counters.</li>
        <li><strong>Vercel</strong> (USA / global) — application hosting and serverless function execution. Processes your IP address and request payloads in transit.</li>
        <li><strong>Legal authorities</strong>, when required by law or to protect our rights.</li>
      </ul>
      <p className="text-xs text-white/40">
        We will update this list when we add or remove a subprocessor. If you have questions about the data flow to any
        of the above, please contact us using the details below.
      </p>

      <h2>6. Data Retention</h2>
      <p>
        We retain your account data for as long as your account is active. If you delete your
        account, we delete your personal data within 30 days, except where retention is required
        for legal, tax, or fraud-prevention purposes.
      </p>

      <h2>7. Your Rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li>Access the personal information we hold about you</li>
        <li>Request correction of inaccurate data</li>
        <li>Request deletion of your data (&quot;right to be forgotten&quot;)</li>
        <li>Export your data in a portable format</li>
        <li>Withdraw consent to optional processing</li>
      </ul>
      <p>
        To exercise any of these rights, email us at{' '}
        <a href="mailto:muditvns@gmail.com">muditvns@gmail.com</a>.
      </p>

      <h2>8. Security</h2>
      <p>
        We use industry-standard technical and organizational measures to protect your data,
        including encryption in transit (TLS), encryption at rest, and row-level access controls
        in our database. No system is perfectly secure, and we cannot guarantee absolute security.
      </p>

      <h2>9. Children&apos;s Privacy</h2>
      <p>
        The Service is not intended for children under 13. We do not knowingly collect personal
        information from children under 13.
      </p>

      <h2>10. International Transfers</h2>
      <p>
        Your information may be processed in countries other than your own. Where required, we
        ensure appropriate safeguards are in place.
      </p>

      <h2>11. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy occasionally. We will notify you of material changes
        by email or through the Service.
      </p>

      <h2>12. Contact</h2>
      <p>
        If you have questions or complaints about this policy, contact us at{' '}
        <a href="mailto:muditvns@gmail.com">muditvns@gmail.com</a>.
      </p>

      <h2>13. Grievance Officer (India)</h2>
      <p>
        Per the Information Technology (Reasonable Security Practices and Procedures and Sensitive
        Personal Data or Information) Rules, 2011 and the Digital Personal Data Protection Act, 2023,
        the designated Grievance Officer for India-based users is:
      </p>
      <p>
        <strong>Mudit Mohilay</strong><br />
        Email: <a href="mailto:muditvns@gmail.com">muditvns@gmail.com</a><br />
        Address: available on request via the email above.
      </p>
      <p>
        Grievances will be acknowledged within 24 hours and resolved within 15 days as required
        by law.
      </p>
    </>
  );
}
