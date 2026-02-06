"use client";

import { useState, useEffect } from "react";
import UnifiedFlow from "./onboarding/unified-flow";

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
        const response = await fetch("/api/user");
        if (response.ok) {
          const user = await response.json();
          if (!user.onboardingCompleted) {
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
        <UnifiedFlow
          username={username}
          onComplete={handleOnboardingComplete}
        />
      )}
      {children}
    </>
  );
}
