"use client";

import { useState, useEffect } from "react";
import UnifiedFlow from "./onboarding/unified-flow";
import DashboardTour from "./dashboard-tour";

interface DashboardWithOnboardingProps {
  username: string;
  children: React.ReactNode;
}

export default function DashboardWithOnboarding({ username, children }: DashboardWithOnboardingProps) {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    async function checkOnboardingStatus() {
      try {
        const response = await fetch("/api/user");
        if (response.ok) {
          const user = await response.json();
          if (!user.onboardingCompleted) {
            setShowOnboarding(true);
          } else {
            // Onboarding done — check if tour has been seen
            try {
              const settingsRes = await fetch("/api/settings");
              if (settingsRes.ok) {
                const settings = await settingsRes.json();
                if (settings.dashboard_tour_seen === false || settings.dashboard_tour_seen === undefined) {
                  setShowTour(true);
                }
              }
            } catch {
              // If settings fetch fails, don't block — just skip tour
            }
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
    // After onboarding, show the tour
    setShowTour(true);
  };

  const handleTourComplete = async () => {
    setShowTour(false);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboard_tour_seen: true }),
      });
    } catch {
      // Non-critical — tour still dismissed
    }
  };

  const handleTourSkip = async () => {
    setShowTour(false);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboard_tour_seen: true }),
      });
    } catch {
      // Non-critical
    }
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
      {showTour && (
        <DashboardTour
          onComplete={handleTourComplete}
          onSkip={handleTourSkip}
        />
      )}
      {children}
    </>
  );
}
