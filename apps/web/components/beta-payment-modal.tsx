"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface BetaPaymentModalProps {
  onComplete: (skipped: boolean) => void;
  userEmail: string;
}

export function BetaPaymentModal({ onComplete, userEmail }: BetaPaymentModalProps) {
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSkip = async () => {
    setLoading(true);
    try {
      // Update user's subscription status to 'beta'
      await fetch("/api/profile/beta-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "beta" }),
      });
      onComplete(true);
    } catch (error) {
      console.error("Error setting beta status:", error);
      // Still continue even if API fails
      onComplete(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // In beta, just skip and mark as beta user
    // When Stripe is properly configured, this would create a real subscription
    await handleSkip();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md animate-in fade-in zoom-in duration-300">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
            <span className="text-2xl">🎉</span>
          </div>
          <CardTitle className="text-2xl bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
            Beta Payment Wall
          </CardTitle>
          <CardDescription className="text-base mt-2">
            Welcome to the Aevoy beta! Credit card is <span className="font-semibold text-green-600">not required</span> during beta.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-4 text-sm">
              <p className="font-medium text-purple-900 dark:text-purple-200 mb-1">Beta User Benefits:</p>
              <ul className="text-purple-700 dark:text-purple-300 space-y-1">
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Unlimited tasks during beta
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Full access to all features
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Priority support
                </li>
              </ul>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Optional payment info</span>
              </div>
            </div>

            <div className="space-y-3 opacity-60">
              <div className="space-y-2">
                <Label htmlFor="card" className="text-muted-foreground">Card Number (optional)</Label>
                <Input
                  id="card"
                  placeholder="4242 4242 4242 4242"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  className="bg-muted"
                  disabled
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="expiry" className="text-muted-foreground">Expiry (optional)</Label>
                  <Input
                    id="expiry"
                    placeholder="MM/YY"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className="bg-muted"
                    disabled
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cvc" className="text-muted-foreground">CVC (optional)</Label>
                  <Input
                    id="cvc"
                    placeholder="123"
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value)}
                    className="bg-muted"
                    disabled
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground/70 text-center">
                Credit card fields disabled during beta period
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button 
              type="button" 
              onClick={handleSkip}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold py-6 text-lg"
              disabled={loading}
            >
              {loading ? "Setting up your account..." : "Skip for now - Get Started Free"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              You can add payment info later in settings
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
