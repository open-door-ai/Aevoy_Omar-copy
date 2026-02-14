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

interface AreaCode {
  code: string;
  city: string;
  state: string;
  region: string;
  country: "US" | "CA";
}

interface PhoneNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string;
  region?: string;
  monthlyCost: number;
}

type FlowStep = "choice" | "area_code" | "preview" | "provisioning" | "success";

export default function StepPhoneNew({ onNext, onBack }: StepPhoneProps) {
  const [step, setStep] = useState<FlowStep>("choice");
  const [selectedRegion, setSelectedRegion] = useState<string>("West");
  const [selectedAreaCode, setSelectedAreaCode] = useState<AreaCode | null>(null);
  const [availableNumbers, setAvailableNumbers] = useState<PhoneNumber[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<PhoneNumber | null>(null);
  const [provisionedPhone, setProvisionedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [areaCodes, setAreaCodes] = useState<Record<string, AreaCode[]>>({});

  // Check if user already has a phone
  useEffect(() => {
    async function checkExistingPhone() {
      try {
        const res = await fetch("/api/phone");
        if (res.ok) {
          const data = await res.json();
          if (data.phone) {
            setProvisionedPhone(data.phone);
            setStep("success");
          }
        }
      } catch {
        // Ignore
      }
    }
    checkExistingPhone();
  }, []);

  // Load area codes
  useEffect(() => {
    async function loadAreaCodes() {
      try {
        const res = await fetch("/api/phone/area-codes");
        if (res.ok) {
          const data = await res.json();
          setAreaCodes(data.grouped);
        }
      } catch (err) {
        console.error("Failed to load area codes:", err);
      }
    }
    loadAreaCodes();
  }, []);

  const handleSelectRegion = (region: string) => {
    setSelectedRegion(region);
  };

  const handleSelectAreaCode = async (areaCode: AreaCode) => {
    setSelectedAreaCode(areaCode);
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/phone/search?areaCode=${areaCode.code}&limit=5`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to search for numbers");
        setLoading(false);
        return;
      }

      if (!data.available || data.numbers.length === 0) {
        setError(`No numbers available in ${areaCode.city} (${areaCode.code}). Try a different area code.`);
        setLoading(false);
        return;
      }

      setAvailableNumbers(data.numbers);
      setStep("preview");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleProvisionNumber = async () => {
    if (!selectedNumber || !selectedAreaCode) return;

    setError(null);
    setLoading(true);

    try {
      setStep("provisioning");
      const res = await fetch("/api/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areaCode: selectedAreaCode.code }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to provision phone number");
        setStep("preview");
        return;
      }

      setProvisionedPhone(data.phone);
      setStep("success");
    } catch {
      setError("Network error. Please try again.");
      setStep("preview");
    } finally {
      setLoading(false);
    }
  };

  const formatPhoneForDisplay = (phone: string): string => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
      const number = digits.slice(1);
      return `+1 (${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6)}`;
    }
    return phone;
  };

  // Success screen
  if (step === "success" && provisionedPhone) {
    return (
      <div className="flex flex-col items-center max-w-2xl mx-auto px-6">
        <FadeIn>
          <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Phone Number Ready!</h2>
          <p className="text-gray-600 mb-8 text-center">
            Your AI phone number has been provisioned and is ready to use
          </p>
        </FadeIn>

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
              className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"
            >
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
              </svg>
            </motion.div>
            <div className="text-3xl font-mono font-bold text-gray-900 mb-2">
              {formatPhoneForDisplay(provisionedPhone)}
            </div>
            <p className="text-green-700 font-medium mb-4">Your AI Phone Number</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-white/50 rounded-lg p-3">
                <p className="text-gray-600 mb-1">Monthly Cost</p>
                <p className="text-lg font-bold text-gray-900">$1.15/mo</p>
              </div>
              <div className="bg-white/50 rounded-lg p-3">
                <p className="text-gray-600 mb-1">Call Cost</p>
                <p className="text-lg font-bold text-gray-900">~$0.02/min</p>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-left">
            <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              What you can do:
            </h3>
            <ul className="space-y-1 text-sm text-blue-800">
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                <span>Call this number to give your AI voice commands</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                <span>Your AI can call you with updates or questions</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                <span>Send SMS messages to assign tasks on the go</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                <span>Forward calls to this number and your AI answers</span>
              </li>
            </ul>
          </div>

          <div className="flex gap-4 w-full">
            <Button variant="outline" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button onClick={() => onNext(provisionedPhone)} className="flex-1">
              Continue
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Provisioning screen
  if (step === "provisioning") {
    return (
      <div className="flex flex-col items-center max-w-2xl mx-auto px-6">
        <FadeIn>
          <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Provisioning Your Number</h2>
          <p className="text-gray-600 mb-8 text-center">
            Setting up your AI phone number, this will take a few seconds...
          </p>
        </FadeIn>

        <div className="w-full max-w-md">
          <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-12 text-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full mx-auto mb-6"
            />
            <p className="text-blue-900 font-medium">Please wait...</p>
          </div>
        </div>
      </div>
    );
  }

  // Preview numbers screen
  if (step === "preview" && selectedAreaCode) {
    return (
      <div className="flex flex-col items-center max-w-2xl mx-auto px-6">
        <FadeIn>
          <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Choose Your Number</h2>
          <p className="text-gray-600 mb-8 text-center">
            Select a phone number in {selectedAreaCode.city}, {selectedAreaCode.state}
          </p>
        </FadeIn>

        <div className="w-full space-y-6">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700"
            >
              {error}
            </motion.div>
          )}

          {loading ? (
            <div className="bg-gray-50 rounded-2xl p-12 text-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="w-12 h-12 border-4 border-gray-200 border-t-blue-600 rounded-full mx-auto mb-4"
              />
              <p className="text-gray-600">Searching for available numbers...</p>
            </div>
          ) : (
            <div className="space-y-3">
              {availableNumbers.map((number, idx) => (
                <motion.button
                  key={number.phoneNumber}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  onClick={() => setSelectedNumber(number)}
                  className={`w-full border-2 rounded-xl p-4 transition-all text-left ${
                    selectedNumber?.phoneNumber === number.phoneNumber
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xl font-mono font-bold text-gray-900">
                        {formatPhoneForDisplay(number.phoneNumber)}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {number.locality || selectedAreaCode.city}, {number.region || selectedAreaCode.state}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-gray-900">${number.monthlyCost}</p>
                      <p className="text-xs text-gray-500">per month</p>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          )}

          <div className="flex gap-4 w-full">
            <Button variant="outline" onClick={() => setStep("area_code")} className="flex-1">
              Back
            </Button>
            <Button
              onClick={handleProvisionNumber}
              disabled={!selectedNumber || loading}
              className="flex-1"
            >
              Provision Number
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Area code selection screen
  if (step === "area_code") {
    const regions = Object.keys(areaCodes);
    const codes = areaCodes[selectedRegion] || [];

    return (
      <div className="flex flex-col items-center max-w-3xl mx-auto px-6">
        <FadeIn>
          <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Select Your Area Code</h2>
          <p className="text-gray-600 mb-8 text-center">
            Choose a local number from your preferred region
          </p>
        </FadeIn>

        <div className="w-full space-y-6">
          {/* Region selector */}
          <div className="flex gap-2 flex-wrap justify-center">
            {regions.map((region) => (
              <button
                key={region}
                onClick={() => handleSelectRegion(region)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  selectedRegion === region
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {region}
              </button>
            ))}
          </div>

          {/* Area code grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {codes.map((areaCode, idx) => (
              <motion.button
                key={areaCode.code}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                onClick={() => handleSelectAreaCode(areaCode)}
                disabled={loading}
                className="border-2 border-gray-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50 transition-all text-left disabled:opacity-50"
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="text-2xl font-bold text-blue-600">{areaCode.code}</span>
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">{areaCode.country}</span>
                </div>
                <p className="font-semibold text-gray-900 text-sm">{areaCode.city}</p>
                <p className="text-xs text-gray-500">{areaCode.state}</p>
              </motion.button>
            ))}
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700"
            >
              {error}
            </motion.div>
          )}

          <div className="flex gap-4 w-full">
            <Button variant="outline" onClick={() => setStep("choice")} className="flex-1">
              Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Initial choice screen
  return (
    <div className="flex flex-col items-center max-w-2xl mx-auto px-6">
      <FadeIn>
        <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Get Your AI Phone Number</h2>
        <p className="text-gray-600 mb-8 text-center">
          Choose how you want to connect with your AI assistant
        </p>
      </FadeIn>

      <div className="w-full space-y-4">
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => setStep("area_code")}
          className="w-full border-2 border-blue-500 bg-blue-50 rounded-2xl p-6 text-left hover:bg-blue-100 transition-all"
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-gray-900 mb-1">Get a Dedicated Number (Recommended)</h3>
              <p className="text-gray-700 mb-3">
                Provision your own AI phone number with a local area code. Voice + SMS enabled.
              </p>
              <div className="flex items-center gap-4 text-sm">
                <span className="bg-white px-3 py-1 rounded-lg font-semibold text-blue-600">$1.15/month</span>
                <span className="text-gray-600">~$0.02/minute for calls</span>
              </div>
            </div>
          </div>
        </motion.button>

        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onClick={() => onNext(null)}
          className="w-full border-2 border-gray-200 bg-gray-50 rounded-2xl p-6 text-left hover:bg-gray-100 transition-all"
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gray-300 rounded-xl flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-gray-900 mb-1">Skip for Now</h3>
              <p className="text-gray-600 mb-3">
                You can always add a phone number later from your dashboard settings.
              </p>
              <p className="text-sm text-gray-500">You'll still have full access to email, chat, and browser features.</p>
            </div>
          </div>
        </motion.button>

        <div className="flex gap-4 w-full pt-4">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Back
          </Button>
        </div>
      </div>
    </div>
  );
}
