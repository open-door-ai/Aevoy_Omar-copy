"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, CheckCircle2, AlertCircle, Loader2, ExternalLink, Copy, Check } from "lucide-react";

interface InboxSetupWizardProps {
  onComplete: () => void;
}

interface ProviderConfig {
  name: string;
  appPasswordUrl: string;
  steps: string[];
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  gmail: {
    name: "Gmail",
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    steps: [
      "Make sure 2-Step Verification is enabled on your Google account",
      "Click the button below to open Google Security settings",
      "Generate an App Password (select 'Mail' and 'Other (Custom name)')",
      "Copy the 16-character password (it looks like: xxxx xxxx xxxx xxxx)",
      "Paste it below - we'll handle the rest automatically"
    ],
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
  },
  outlook: {
    name: "Outlook / Hotmail",
    appPasswordUrl: "https://account.live.com/proofs/AppPassword",
    steps: [
      "Click the button below to open Microsoft Security settings",
      "Create an App Password",
      "Copy the generated password",
      "Paste it below - we'll configure everything automatically"
    ],
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp-mail.outlook.com",
    smtpPort: 587,
  },
};

export function InboxSetupWizard({ onComplete }: InboxSetupWizardProps) {
  const [activeProvider, setActiveProvider] = useState<"gmail" | "outlook">("gmail");
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const provider = PROVIDERS[activeProvider];

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(email);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const handleOpenAppPasswordPage = () => {
    window.open(provider.appPasswordUrl, "_blank", "noopener,noreferrer");
  };

  const handleTestConnection = async () => {
    if (!email || !appPassword) {
      setTestResult({ success: false, message: "Please enter both email and app password" });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch("/api/integrations/inbox/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: appPassword,
          provider: activeProvider,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setTestResult({
          success: true,
          message: "Connection successful! Your inbox is ready to connect."
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || "Connection failed. Please check your credentials and try again."
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: "Network error. Please try again."
      });
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = async () => {
    if (!email || !appPassword) {
      setTestResult({ success: false, message: "Please enter both email and app password" });
      return;
    }

    setConnecting(true);
    setTestResult(null);

    try {
      const response = await fetch("/api/integrations/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: appPassword,
          provider: activeProvider,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        onComplete();
      } else {
        setTestResult({
          success: false,
          message: data.error || "Failed to connect inbox. Please try again."
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: "Network error. Please try again."
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDetectProvider = (emailValue: string) => {
    setEmail(emailValue);
    const domain = emailValue.split("@")[1]?.toLowerCase();

    if (domain?.includes("gmail.com") || domain?.includes("googlemail.com")) {
      setActiveProvider("gmail");
    } else if (domain?.includes("outlook.com") || domain?.includes("hotmail.com") || domain?.includes("live.com")) {
      setActiveProvider("outlook");
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mail className="w-6 h-6" />
          <CardTitle>Connect Your Inbox</CardTitle>
        </div>
        <CardDescription>
          One-click inbox setup - no technical configuration needed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={activeProvider} onValueChange={(v) => setActiveProvider(v as "gmail" | "outlook")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="gmail">Google</TabsTrigger>
            <TabsTrigger value="outlook">Microsoft</TabsTrigger>
          </TabsList>

          <TabsContent value="gmail" className="space-y-4 mt-4">
            <InboxSetupSteps provider={provider} />
          </TabsContent>

          <TabsContent value="outlook" className="space-y-4 mt-4">
            <InboxSetupSteps provider={provider} />
          </TabsContent>
        </Tabs>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Your {provider.name} Email</Label>
            <Input
              id="email"
              type="email"
              placeholder={`your.email@${activeProvider === "gmail" ? "gmail.com" : "outlook.com"}`}
              value={email}
              onChange={(e) => handleDetectProvider(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="appPassword">App Password</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleOpenAppPasswordPage}
                className="text-xs"
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                Generate App Password
              </Button>
            </div>
            <Input
              id="appPassword"
              type="password"
              placeholder="xxxx xxxx xxxx xxxx"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value.replace(/\s/g, ""))}
              maxLength={16}
            />
            <p className="text-xs text-muted-foreground">
              Paste the 16-character app password (spaces will be removed automatically)
            </p>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 p-3 rounded-lg ${
              testResult.success
                ? "bg-green-50 dark:bg-green-950/30 text-green-900 dark:text-green-100"
                : "bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-100"
            }`}>
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              )}
              <p className="text-sm">{testResult.message}</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || connecting || !email || !appPassword}
              className="flex-1"
            >
              {testing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </Button>
            <Button
              onClick={handleConnect}
              disabled={connecting || testing || !email || !appPassword}
              className="flex-1"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect Inbox"
              )}
            </Button>
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg space-y-2">
          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
            Why App Passwords?
          </p>
          <p className="text-xs text-blue-800 dark:text-blue-200">
            App passwords are more secure than using your main password. They let your AI access your inbox without exposing your primary account credentials. You can revoke them anytime from your {provider.name} security settings.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function InboxSetupSteps({ provider }: { provider: ProviderConfig }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Setup Steps:</p>
      <ol className="space-y-2">
        {provider.steps.map((step, index) => (
          <li key={index} className="flex gap-3 text-sm">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">
              {index + 1}
            </span>
            <span className="text-muted-foreground">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
