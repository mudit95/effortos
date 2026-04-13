export const metadata = { title: 'Cancellation & Refund — EffortOS' };

export default function RefundPage() {
  return (
    <>
      <h1>Cancellation & Refund Policy</h1>
      <p className="text-xs text-white/40">Last updated: April 14, 2026</p>

      <p>
        EffortOS is a software subscription service. This policy describes how cancellation
        and refunds are handled.
      </p>

      <h2>1. Free Trial</h2>
      <p>
        New users receive a 3-day free trial. No payment is charged during the trial. If you
        cancel before the trial ends, you will not be billed.
      </p>

      <h2>2. Cancelling Your Subscription</h2>
      <p>
        You can cancel your subscription at any time from <strong>Settings → Subscription</strong>{' '}
        inside the app. Once cancelled, your subscription remains active until the end of the
        current billing period, and you will not be charged again.
      </p>

      <h2>3. Refund Eligibility</h2>
      <p>
        Because EffortOS is a digital service with a free trial, we generally do not offer
        refunds for completed billing periods. However, we will consider a refund in the
        following cases:
      </p>
      <ul>
        <li>You were charged in error or double-charged</li>
        <li>A technical issue on our side prevented you from using the Service for an extended period</li>
        <li>You were charged immediately after cancelling and the cancellation was not recorded</li>
      </ul>

      <h2>4. How to Request a Refund</h2>
      <p>
        Send an email to <a href="mailto:muditvns@gmail.com">muditvns@gmail.com</a> within
        <strong> 7 days </strong> of the charge you want refunded. Include:
      </p>
      <ul>
        <li>Your account email</li>
        <li>The date and amount of the charge</li>
        <li>A brief explanation of your reason for the request</li>
      </ul>

      <h2>5. Refund Processing</h2>
      <p>
        Approved refunds are processed back to the original payment method via Razorpay and
        typically take <strong>5–10 business days</strong> to appear on your statement depending
        on your bank.
      </p>

      <h2>6. Chargebacks</h2>
      <p>
        Please contact us before initiating a chargeback with your bank. We want to help resolve
        any issue directly, and chargebacks may result in suspension of your account while
        disputed.
      </p>

      <h2>7. Contact</h2>
      <p>
        Questions? Email{' '}
        <a href="mailto:muditvns@gmail.com">muditvns@gmail.com</a>.
      </p>
    </>
  );
}
