import { Shield, Lock, Eye, Database } from "lucide-react";

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-12">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">Security & Safety</h1>
          <p className="text-xl text-muted-foreground">
            How we keep you safe while your AI works for you
          </p>
        </div>

        {/* How We Keep You Safe */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="w-8 h-8 text-primary" />
            How We Keep You Safe
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="border rounded-lg p-6 space-y-2">
              <h3 className="text-xl font-semibold">Intent Locking</h3>
              <p className="text-muted-foreground">
                Immutable task scopes prevent scope creep. Your AI can't do more than you asked for.
              </p>
            </div>
            <div className="border rounded-lg p-6 space-y-2">
              <h3 className="text-xl font-semibold">Budget Limits</h3>
              <p className="text-muted-foreground">
                Agent card caps, daily proactive limits — you control spending at every level.
              </p>
            </div>
            <div className="border rounded-lg p-6 space-y-2">
              <h3 className="text-xl font-semibold">3-Step Verification</h3>
              <p className="text-muted-foreground">
                Self-check → Evidence → Smart review. Every task is verified before being marked complete.
              </p>
            </div>
            <div className="border rounded-lg p-6 space-y-2">
              <h3 className="text-xl font-semibold">Human Oversight</h3>
              <p className="text-muted-foreground">
                2FA failures and high-risk actions automatically trigger confirmation requests.
              </p>
            </div>
          </div>
        </section>

        {/* What Could Go Wrong */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold">What Could Go Wrong (And How to Prevent It)</h2>
          <div className="space-y-4">
            <div className="border-l-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10 p-6">
              <h3 className="font-semibold text-lg mb-2">Scenario: Booking wrong flight</h3>
              <p className="text-muted-foreground mb-2">AI misunderstands dates or destinations</p>
              <p className="font-medium">✅ Fix: Set confirmation mode to "When unsure"</p>
            </div>
            <div className="border-l-4 border-red-500 bg-red-50 dark:bg-red-900/10 p-6">
              <h3 className="font-semibold text-lg mb-2">Scenario: Buying wrong item</h3>
              <p className="text-muted-foreground mb-2">AI purchases something you didn't want</p>
              <p className="font-medium">✅ Fix: Set agent card limit to $50-200</p>
            </div>
            <div className="border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/10 p-6">
              <h3 className="font-semibold text-lg mb-2">Scenario: Sending wrong email</h3>
              <p className="text-muted-foreground mb-2">AI emails the wrong person or wrong message</p>
              <p className="font-medium">✅ Fix: Enable draft review in settings</p>
            </div>
            <div className="border-l-4 border-purple-500 bg-purple-50 dark:bg-purple-900/10 p-6">
              <h3 className="font-semibold text-lg mb-2">Scenario: Missing 2FA code</h3>
              <p className="text-muted-foreground mb-2">AI can't log in without verification code</p>
              <p className="font-medium">✅ Fix: Use virtual number verification ($1/mo)</p>
            </div>
          </div>
        </section>

        {/* Your Controls */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold flex items-center gap-3">
            <Lock className="w-8 h-8 text-primary" />
            Your Controls
          </h2>
          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <span className="text-primary font-bold">•</span>
              <div>
                <strong>Freeze agent card instantly</strong> — Revokes all purchase permissions in real-time
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary font-bold">•</span>
              <div>
                <strong>Revoke OAuth access</strong> — Disconnect Gmail, Microsoft, or any integrated service anytime
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary font-bold">•</span>
              <div>
                <strong>Export all data</strong> — GDPR-compliant JSON download of your complete data
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary font-bold">•</span>
              <div>
                <strong>Delete account anytime</strong> — Permanent and irreversible deletion in one click
              </div>
            </li>
          </ul>
        </section>

        {/* Transparency */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold flex items-center gap-3">
            <Eye className="w-8 h-8 text-primary" />
            Transparency
          </h2>
          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <span className="text-primary font-bold">•</span>
              <div>
                <strong>Public Hive Mind</strong> — Collective learnings and agent vents visible to all users
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary font-bold">•</span>
              <div>
                <strong>Cost tracking</strong> — Every AI call logged in ai_cost_log table, accessible via API
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary font-bold">•</span>
              <div>
                <strong>No hidden fees</strong> — All pricing upfront, no surprises
              </div>
            </li>
          </ul>
        </section>

        {/* Data Protection */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold flex items-center gap-3">
            <Database className="w-8 h-8 text-primary" />
            Data Protection
          </h2>
          <div className="border rounded-lg p-6 space-y-4">
            <p>
              <strong>Encryption:</strong> All credentials, memory, and OAuth tokens encrypted with AES-256-GCM
            </p>
            <p>
              <strong>No Third-Party Sharing:</strong> We never share personal data. Hive Mind learnings are anonymized.
            </p>
            <p>
              <strong>GDPR Rights:</strong> Export or delete all data anytime via{" "}
              <a href="/dashboard/settings" className="text-primary hover:underline">
                Settings → Export Data / Delete Account
              </a>
            </p>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center pt-8 border-t">
          <p className="text-muted-foreground">
            Questions about security?{" "}
            <a href="mailto:security@aevoy.com" className="text-primary hover:underline">
              security@aevoy.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
