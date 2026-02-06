"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn, motion, springs } from "@/components/ui/motion";

interface StepPhoneProps {
  onNext: (phone: string | null) => void;
  onBack: () => void;
}

export default function StepPhone({ onNext, onBack }: StepPhoneProps) {
  const [areaCode, setAreaCode] = useState("604");
  const [provisioning, setProvisioning] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check if user already has a phone
  useEffect(() => {
    async function checkPhone() {
      try {
        const res = await fetch("/api/phone");
        if (res.ok) {
          const data = await res.json();
          if (data.phone) setPhone(data.phone);
        }
      } catch {
        // Ignore
      }
    }
    checkPhone();
  }, []);

  const handleProvision = async () => {
    setProvisioning(true);
    setError(null);

    try {
      const res = await fetch("/api/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areaCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to provision number");
        return;
      }

      setPhone(data.phone);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="flex flex-col items-center max-w-lg mx-auto px-6">
      <FadeIn>
        <h2 className="text-3xl font-bold text-stone-900 mb-2 text-center">Your AI Phone</h2>
        <p className="text-stone-500 mb-8 text-center">
          Get a phone number so your AI can make calls and send texts on your behalf
        </p>
      </FadeIn>

      {phone ? (
        /* Phone provisioned */
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={springs.default}
          className="w-full text-center space-y-6"
        >
          <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={springs.bouncy}
              className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"
            >
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </motion.div>
            {/* Staggered digit reveal */}
            <div className="text-3xl font-mono font-bold text-stone-900 mb-2 flex justify-center">
              {phone.split("").map((char, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, ...springs.micro }}
                >
                  {char}
                </motion.span>
              ))}
            </div>
            <p className="text-green-700 text-sm">Voice + SMS enabled</p>
          </div>

          <div className="bg-stone-50 border border-stone-200 rounded-xl p-4">
            <p className="text-sm text-stone-500 mb-1">Try texting your AI:</p>
            <p className="text-stone-700 font-medium italic">
              &quot;What&apos;s the weather like today?&quot;
            </p>
          </div>

          <div className="flex gap-4 w-full">
            <Button variant="outline" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button onClick={() => onNext(phone)} className="flex-1">
              Continue
            </Button>
          </div>
        </motion.div>
      ) : (
        /* Phone provisioning form */
        <FadeIn delay={0.15} className="w-full">
          <div className="w-full space-y-6">
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-stone-200 rounded-lg flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-stone-900">Voice & SMS</p>
                  <p className="text-sm text-stone-500">
                    Your AI can call businesses, answer calls, and handle text messages
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="areaCode" className="text-stone-600">
                  Preferred area code
                </Label>
                <Input
                  id="areaCode"
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  placeholder="604"
                  className="font-mono text-lg w-32"
                  maxLength={3}
                />
              </div>

              {error && (
                <p className="text-sm text-red-500">{error}</p>
              )}

              <Button
                onClick={handleProvision}
                disabled={provisioning || areaCode.length !== 3}
                className="w-full"
              >
                {provisioning ? "Provisioning..." : "Get My Phone Number"}
              </Button>
            </div>

            <div className="flex gap-4 w-full">
              <Button variant="outline" onClick={onBack} className="flex-1">
                Back
              </Button>
              <button
                onClick={() => onNext(null)}
                className="flex-1 text-stone-400 hover:text-stone-600 text-sm transition-colors underline underline-offset-4"
              >
                Skip for now
              </button>
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  );
}
