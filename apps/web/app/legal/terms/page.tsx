export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-4xl mx-auto prose prose-slate dark:prose-invert">
        <h1>Terms of Service</h1>
        <p className="lead">Last updated: February 6, 2025</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using Aevoy ("the Service"), you agree to be bound by these Terms of Service.
          If you disagree with any part of the terms, you may not access the Service.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          Aevoy is an AI-powered task automation service that uses artificial intelligence to complete
          tasks on your behalf, including but not limited to web browsing, form filling, email management,
          booking services, and research.
        </p>

        <h2>3. User Responsibilities</h2>
        <p>
          <strong>You accept full responsibility for AI actions taken on your behalf.</strong> This includes:
        </p>
        <ul>
          <li>All purchases made by your AI agent</li>
          <li>All communications sent on your behalf</li>
          <li>All bookings and reservations made</li>
          <li>All form submissions and applications</li>
        </ul>

        <h2>4. AI Accuracy and Limitations</h2>
        <p>
          <strong>Aevoy is 99.9999% accurate but not perfect.</strong> The AI may:
        </p>
        <ul>
          <li>Misunderstand task requirements</li>
          <li>Book incorrect dates or destinations</li>
          <li>Purchase wrong items</li>
          <li>Send messages to unintended recipients</li>
        </ul>
        <p>
          <strong>You are encouraged to review critical tasks before execution.</strong>
        </p>

        <h2>5. Liability Limitations</h2>
        <p>
          Aevoy is not liable for:
        </p>
        <ul>
          <li>Incorrect bookings, purchases, or communications made by the AI</li>
          <li>Financial losses resulting from AI errors</li>
          <li>Missed deadlines or opportunities</li>
          <li>Third-party service failures or unavailability</li>
        </ul>

        <h2>6. Agent Card and Payments</h2>
        <p>
          If you enable the Agent Card feature:
        </p>
        <ul>
          <li>You are responsible for funding the card</li>
          <li>You are responsible for all purchases made with the card</li>
          <li>You can freeze or delete the card at any time</li>
          <li>Set appropriate transaction and monthly limits to control spending</li>
        </ul>

        <h2>7. Beta Program</h2>
        <p>
          Beta users receive:
        </p>
        <ul>
          <li>Unlimited usage during the beta period</li>
          <li>Full refund within 30 days if not satisfied, no questions asked</li>
          <li>Early access to new features</li>
        </ul>
        <p>
          Beta status may be revoked at Aevoy's discretion with 30 days notice.
        </p>

        <h2>8. Privacy and Data</h2>
        <p>
          Your privacy is important. See our{" "}
          <a href="/legal/privacy" className="text-primary hover:underline">
            Privacy Policy
          </a>{" "}
          for details on data collection and usage.
        </p>
        <ul>
          <li>All credentials encrypted with AES-256-GCM</li>
          <li>We never share personal data with third parties</li>
          <li>You can export or delete all data anytime</li>
        </ul>

        <h2>9. Prohibited Uses</h2>
        <p>You may not use Aevoy to:</p>
        <ul>
          <li>Violate any laws or regulations</li>
          <li>Harass, abuse, or harm others</li>
          <li>Distribute spam or malicious content</li>
          <li>Impersonate others or misrepresent your identity</li>
          <li>Access systems or data without authorization</li>
        </ul>

        <h2>10. Termination</h2>
        <p>
          We reserve the right to terminate or suspend your account immediately, without prior notice,
          for conduct that we believe violates these Terms or is harmful to other users.
        </p>
        <p>
          You may terminate your account at any time through Settings → Delete Account.
        </p>

        <h2>11. Changes to Terms</h2>
        <p>
          We reserve the right to modify these terms at any time. We will notify you of significant
          changes via email. Continued use of the Service after changes constitutes acceptance.
        </p>

        <h2>12. Governing Law</h2>
        <p>
          These Terms shall be governed by the laws of British Columbia, Canada, without regard to
          its conflict of law provisions.
        </p>

        <h2>13. Contact</h2>
        <p>
          Questions about these Terms?{" "}
          <a href="mailto:legal@aevoy.com" className="text-primary hover:underline">
            legal@aevoy.com
          </a>
        </p>

        <hr className="my-8" />

        <p className="text-sm text-muted-foreground">
          By using Aevoy, you acknowledge that you have read, understood, and agree to be bound by
          these Terms of Service.
        </p>
      </div>
    </div>
  );
}
