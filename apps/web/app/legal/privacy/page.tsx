export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-4xl mx-auto prose prose-slate dark:prose-invert">
        <h1>Privacy Policy</h1>
        <p className="lead">Last updated: February 6, 2025</p>

        <h2>1. Information We Collect</h2>
        <h3>Account Information</h3>
        <ul>
          <li>Email address</li>
          <li>Username</li>
          <li>Display name (optional)</li>
          <li>Timezone</li>
          <li>Phone number (if you provision one)</li>
        </ul>

        <h3>Task Data</h3>
        <ul>
          <li>Task descriptions and instructions sent via email, SMS, voice, or chat</li>
          <li>Task execution logs and results</li>
          <li>Screenshots and evidence from completed tasks</li>
        </ul>

        <h3>Credentials (Encrypted)</h3>
        <ul>
          <li>Website login credentials (encrypted with AES-256-GCM)</li>
          <li>OAuth tokens for connected services (encrypted)</li>
          <li>2FA codes temporarily stored for task execution</li>
          <li>Agent card payment information (tokenized, not stored)</li>
        </ul>

        <h3>Usage Data</h3>
        <ul>
          <li>Number of tasks completed</li>
          <li>AI model usage and costs</li>
          <li>Browser session metadata</li>
          <li>Error logs and debugging information</li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <p>We use your information to:</p>
        <ul>
          <li>Execute tasks on your behalf</li>
          <li>Improve AI accuracy and performance</li>
          <li>Provide customer support</li>
          <li>Send service notifications (task completion, errors, etc.)</li>
          <li>Generate anonymized collective learnings (Hive Mind)</li>
          <li>Bill for usage and services</li>
        </ul>

        <h2>3. Data Encryption</h2>
        <p>
          <strong>All sensitive data is encrypted:</strong>
        </p>
        <ul>
          <li>
            <strong>Credentials:</strong> AES-256-GCM encryption with unique salt and IV per record
          </li>
          <li>
            <strong>User Memory:</strong> Encrypted before storage, decrypted only during task execution
          </li>
          <li>
            <strong>OAuth Tokens:</strong> Encrypted and automatically refreshed
          </li>
          <li>
            <strong>In Transit:</strong> All data encrypted with TLS 1.3
          </li>
        </ul>

        <h2>4. Data Sharing</h2>
        <p>
          <strong>We NEVER share your personal data with third parties.</strong>
        </p>
        <p>The only exception is:</p>
        <ul>
          <li>
            <strong>Hive Mind:</strong> Anonymized task learnings (no personal data, no email content,
            no credentials) shared collectively to improve AI performance for all users
          </li>
        </ul>
        <p>You can opt out of Hive Mind in Settings.</p>

        <h2>5. Third-Party Services</h2>
        <p>We use these third-party services:</p>
        <ul>
          <li>
            <strong>Supabase:</strong> Database and authentication (data encrypted at rest)
          </li>
          <li>
            <strong>Vercel:</strong> Web hosting
          </li>
          <li>
            <strong>Browserbase:</strong> Browser automation infrastructure
          </li>
          <li>
            <strong>Twilio:</strong> Phone and SMS services
          </li>
          <li>
            <strong>Resend:</strong> Email delivery
          </li>
          <li>
            <strong>Groq, DeepSeek, Claude, Gemini:</strong> AI model providers
          </li>
        </ul>
        <p>We have data processing agreements with all providers.</p>

        <h2>6. Data Retention</h2>
        <ul>
          <li>
            <strong>Task Data:</strong> Retained for 90 days, then archived
          </li>
          <li>
            <strong>Credentials:</strong> Retained while account is active
          </li>
          <li>
            <strong>User Memory:</strong> Subject to decay algorithm (importance decreases over time)
          </li>
          <li>
            <strong>2FA Codes:</strong> Deleted after 10 minutes or task completion
          </li>
          <li>
            <strong>Session Data:</strong> Expires after 7 days
          </li>
        </ul>

        <h2>7. Your Rights (GDPR)</h2>
        <p>You have the right to:</p>
        <ul>
          <li>
            <strong>Access:</strong> Download all your data via Settings → Export Data (JSON format)
          </li>
          <li>
            <strong>Rectification:</strong> Update your profile and preferences anytime
          </li>
          <li>
            <strong>Erasure:</strong> Delete your account via Settings → Delete Account (permanent)
          </li>
          <li>
            <strong>Portability:</strong> Export data in machine-readable JSON format
          </li>
          <li>
            <strong>Objection:</strong> Opt out of Hive Mind learnings sharing
          </li>
        </ul>

        <h2>8. Data Deletion</h2>
        <p>When you delete your account:</p>
        <ul>
          <li>All personal data deleted within 30 days</li>
          <li>Credentials immediately revoked</li>
          <li>OAuth connections disconnected</li>
          <li>Agent card cancelled and funds returned</li>
          <li>Anonymized learnings retained for Hive Mind (no linkage to you)</li>
        </ul>

        <h2>9. Cookies and Tracking</h2>
        <p>We use minimal cookies:</p>
        <ul>
          <li>
            <strong>Authentication:</strong> Session cookies for login (required)
          </li>
          <li>
            <strong>Preferences:</strong> Dark mode, language (localStorage)
          </li>
        </ul>
        <p>We do NOT use:</p>
        <ul>
          <li>Advertising trackers</li>
          <li>Analytics cookies (no Google Analytics, no third-party tracking)</li>
          <li>Cross-site tracking</li>
        </ul>

        <h2>10. Children's Privacy</h2>
        <p>
          Aevoy is not intended for users under 18. We do not knowingly collect data from children.
          If we discover we have collected data from a child, we will delete it immediately.
        </p>

        <h2>11. International Data Transfers</h2>
        <p>
          Your data is stored in the United States (Supabase, Vercel). By using Aevoy, you consent
          to this transfer. We ensure adequate safeguards through standard contractual clauses.
        </p>

        <h2>12. Data Breach Notification</h2>
        <p>
          In the unlikely event of a data breach, we will:
        </p>
        <ul>
          <li>Notify affected users within 72 hours</li>
          <li>Provide details on what data was compromised</li>
          <li>Recommend protective actions</li>
          <li>Report to regulatory authorities as required</li>
        </ul>

        <h2>13. Changes to Privacy Policy</h2>
        <p>
          We may update this policy from time to time. We will notify you of significant changes
          via email. Continued use after changes constitutes acceptance.
        </p>

        <h2>14. Contact & Data Protection Officer</h2>
        <p>
          Questions or concerns about privacy?
        </p>
        <p>
          Email:{" "}
          <a href="mailto:privacy@aevoy.com" className="text-primary hover:underline">
            privacy@aevoy.com
          </a>
        </p>
        <p>
          Data Protection Officer:{" "}
          <a href="mailto:dpo@aevoy.com" className="text-primary hover:underline">
            dpo@aevoy.com
          </a>
        </p>

        <hr className="my-8" />

        <p className="text-sm text-muted-foreground">
          This Privacy Policy is compliant with GDPR, CCPA, and Canadian privacy laws (PIPEDA).
        </p>
      </div>
    </div>
  );
}
