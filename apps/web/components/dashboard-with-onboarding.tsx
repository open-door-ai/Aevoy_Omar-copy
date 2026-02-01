"use client";

import { useState, useEffect } from "react";
import OnboardingWizard from "./onboarding-wizard";

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
          // If no settings exist or they're default values, show onboarding
          // We check if user_id exists - if settings were never created, it won't exist
          if (!settings.user_id || settings.user_id === undefined) {
            setShowOnboarding(true);
          }
        } else if (response.status === 404) {
          // No settings found, show onboarding
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
        <OnboardingWizard 
          username={username} 
          onComplete={handleOnboardingComplete} 
        />
      )}
      {children}
    </>
  );
}
