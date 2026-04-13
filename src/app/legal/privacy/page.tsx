export const metadata = { title: 'Privacy Policy — EffortOS' };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-xs text-white/40">Last updated: April 14, 2026</p>

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
        Certain features (insights, motivation, plan suggestions) send summaries of your
        productivity data to an AI provider (Anthropic&apos;s Claude) for processing. We do not
        send personally identifying information beyond what is necessary to generate a response,
        and we do not allow this data to be used to train third-party models.
      </p>

      <h2>4. Cookies and Local Storage</h2>
      <p>
        We use cookies and browser local storage to keep you signed in, remember your
        preferences, and cache your data for offline use. You can clear this data from your
        browser settings at any time.
      </p>

      <h2>5. How We Share Information</h2>
      <p>We do not sell your personal information. We share data only with:</p>
      <ul>
        <li><strong>Supabase</strong> — our database and authentication provider</li>
        <li><strong>Razorpay</strong> — for payment processing</li>
        <li><strong>Anthropic</strong> — for AI features, with minimal data as described above</li>
        <li><strong>Legal authorities</strong>, when required by law or to protect our rights</li>
      </ul>

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
    </>
  );
}
