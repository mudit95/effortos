export const metadata = { title: 'Contact Us — EffortOS' };

export default function ContactPage() {
  return (
    <>
      <h1>Contact Us</h1>
      <p className="text-xs text-white/40">We typically respond within 1–2 business days.</p>

      <h2>Support & Billing</h2>
      <p>
        For help with your account, billing questions, refund requests, or bug reports, email:
      </p>
      <p>
        <a href="mailto:muditvns@gmail.com">muditvns@gmail.com</a>
      </p>

      <h2>Privacy & Data Requests</h2>
      <p>
        For privacy-related questions or requests to access, correct, or delete your personal
        data, use the same address:
      </p>
      <p>
        <a href="mailto:muditvns@gmail.com">muditvns@gmail.com</a>
      </p>

      <h2>Legal</h2>
      <p>
        For legal notices, takedown requests, or law-enforcement inquiries, email{' '}
        <a href="mailto:muditvns@gmail.com">muditvns@gmail.com</a> with subject line
        &quot;Legal Inquiry&quot;.
      </p>

      <h2>Business Details</h2>
      <p>
        <strong>Operator:</strong> Mudit Mohilay
        <br />
        <strong>Email:</strong> <a href="mailto:muditvns@gmail.com">muditvns@gmail.com</a>
        <br />
        <strong>Service:</strong> EffortOS — AI-powered productivity subscription
      </p>

      <p className="text-xs text-white/40 mt-8">
        Please include your account email in every message so we can find your account quickly.
      </p>
    </>
  );
}
