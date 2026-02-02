"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface OnboardingWizardProps {
  username: string;
  onComplete: () => void;
}

type ConfirmationMode = "always" | "unclear" | "risky" | "never";
type VerificationMethod = "forward" | "virtual_number";

export default function OnboardingWizard({ username, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [confirmationMode, setConfirmationMode] = useState<ConfirmationMode>("unclear");
  const [verificationMethod, setVerificationMethod] = useState<VerificationMethod>("forward");
  const [agentCardEnabled, setAgentCardEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleComplete = async () => {
    setSaving(true);

    try {
      // Save settings
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation_mode: confirmationMode,
          verification_method: verificationMethod,
          agent_card_enabled: agentCardEnabled,
        }),
      });

      // Create agent card if enabled
      if (agentCardEnabled) {
        await fetch("/api/agent-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create" }),
        });
      }

      onComplete();
    } catch (error) {
      console.error("Failed to save onboarding settings:", error);
      onComplete(); // Still complete, settings can be changed later
    }

    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  s <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
          <CardTitle>
            {step === 1 && "Welcome to Aevoy!"}
            {step === 2 && "Verification Codes"}
            {step === 3 && "Agent Card"}
          </CardTitle>
          <CardDescription>
            {step === 1 && "Let's set up your AI assistant preferences"}
            {step === 2 && "How should your AI handle login verification?"}
            {step === 3 && "Enable purchases by your AI"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {step === 1 && (
            <>
              <p className="text-sm text-muted-foreground">
                Your AI email address is: <strong>{username}@aevoy.com</strong>
              </p>
              <p className="text-sm text-muted-foreground">
                How much should your AI check with you before acting?
              </p>
              <div className="grid gap-2">
                {[
                  { value: "always", label: "Always confirm", description: "Safest option - confirm every task" },
                  { value: "unclear", label: "When unsure", description: "Recommended - confirm only when AI isn't confident" },
                  { value: "risky", label: "Risky actions only", description: "Confirm for payments, logins, emails" },
                  { value: "never", label: "Never confirm", description: "Full autonomy - AI acts immediately" },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      confirmationMode === option.value
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="confirmation"
                      value={option.value}
                      checked={confirmationMode === option.value}
                      onChange={(e) => setConfirmationMode(e.target.value as ConfirmationMode)}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-medium">{option.label}</p>
                      <p className="text-sm text-muted-foreground">{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm text-muted-foreground">
                When your AI logs into websites for you, it may encounter verification codes (2FA).
                How should it handle them?
              </p>
              <div className="grid gap-2">
                {[
                  { 
                    value: "forward", 
                    label: "I'll forward codes", 
                    description: "Free - AI emails you when it needs a code, you reply with it",
                    price: "Free"
                  },
                  { 
                    value: "virtual_number", 
                    label: "Auto-receive codes", 
                    description: "Get a virtual phone number that automatically receives codes",
                    price: "$1/month"
                  },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      verificationMethod === option.value
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="verification"
                      value={option.value}
                      checked={verificationMethod === option.value}
                      onChange={(e) => setVerificationMethod(e.target.value as VerificationMethod)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex justify-between">
                        <p className="font-medium">{option.label}</p>
                        <span className="text-sm text-muted-foreground">{option.price}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm text-muted-foreground">
                Want your AI to be able to make purchases for you? We&apos;ll create a virtual prepaid card
                that you control - you fund it, set limits, and can freeze it anytime.
              </p>
              <div className="grid gap-2">
                {[
                  { 
                    value: true, 
                    label: "Yes, create my agent card", 
                    description: "I'll fund it and set limits. AI can make purchases with my approval.",
                  },
                  { 
                    value: false, 
                    label: "No, just tell me what to buy", 
                    description: "AI will research and recommend, but I'll make purchases myself.",
                  },
                ].map((option) => (
                  <label
                    key={String(option.value)}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      agentCardEnabled === option.value
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="agentCard"
                      checked={agentCardEnabled === option.value}
                      onChange={() => setAgentCardEnabled(option.value)}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-medium">{option.label}</p>
                      <p className="text-sm text-muted-foreground">{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
              {agentCardEnabled && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">
                  Your card will start with a $0 balance. You can add funds anytime via email:
                  &quot;Add $50 to my card&quot;
                </div>
              )}
            </>
          )}
        </CardContent>

        <CardFooter className="flex justify-between">
          {step > 1 ? (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : (
            <div />
          )}

          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button onClick={handleComplete} disabled={saving}>
              {saving ? "Setting up..." : "Get Started"}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
