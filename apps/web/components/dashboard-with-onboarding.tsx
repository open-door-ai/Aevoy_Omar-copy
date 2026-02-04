"use client";

import { useState, useEffect } from "react";
import OnboardingFlow from "./onboarding/onboarding-flow";

interface DashboardWithOnboardingProps {
  username: string;
  children: React.ReactNode;
}

export default function DashboardWithOnboarding({ username, children }: DashboardWithOnboardingProps) {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    async function checkOnboardingStatus() {
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const settings = await response.json();
          // Show onboarding if settings were never created (no user_id means defaults returned)
          if (!settings.user_id || settings.user_id === undefined) {
            setShowOnboarding(true);
          }
        } else if (response.status === 404) {
          setShowOnboarding(true);
        }
      } catch (error) {
        console.error("Failed to check onboarding status:", error);
      }
      setChecked(true);
    }

    checkOnboardingStatus();
  }, []);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  // Don't render anything until we've checked
  if (!checked) {
    return null;
  }

  return (
    <>
      {showOnboarding && (
        <OnboardingFlow
          username={username}
          onComplete={handleOnboardingComplete}
        />
      )}
      {children}
    </>
  );
}
