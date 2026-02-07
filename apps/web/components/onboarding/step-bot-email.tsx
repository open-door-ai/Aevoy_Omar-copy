"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn, GlassCard, motion, springs, AnimatePresence } from "@/components/ui/motion";

interface StepBotEmailProps {
  currentUsername: string;
  currentBotName: string | null;
  onNext: (username: string, botName: string) => void;
  onBack: () => void;
}

const CURATED_NAMES = [
  "Aria", "Nova", "Atlas", "Sage", "Echo", "Orion",
  "Milo", "Luna", "Kai", "Zara", "Finn", "Iris",
  "Rex", "Nyx", "Sol", "Dash", "Lux", "Pax",
  "Rio", "Vex", "Juno", "Bolt", "Cleo", "Dex",
  "Eve", "Flux", "Halo", "Jade", "Knox", "Link",
  "Mars", "Neo", "Onyx", "Pike", "Quip", "Rune",
  "Tao", "Uma", "Vale", "Wren", "Xion", "Zeno",
];

const QUICK_PICKS = ["Aria", "Nova", "Atlas", "Sage", "Echo", "Orion"];

const SUFFIXES = ["ai", "bot", "hq", "go", "run", "do", "pro"];
const PREFIXES = ["ask", "hey", "my", "the"];
const CONNECTORS = ["-", "_", ""];

function generateEmailSuggestions(botName: string): string[] {
  const name = botName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (name.length < 2) return [];

  const suggestions = new Set<string>();

  // name + suffix combos
  for (const suffix of SUFFIXES) {
    for (const conn of CONNECTORS) {
      const s = `${name}${conn}${suffix}`;
      if (s.length >= 3 && s.length <= 20) suggestions.add(s);
    }
  }

  // prefix + name combos
  for (const prefix of PREFIXES) {
    for (const conn of CONNECTORS) {
      const s = `${prefix}${conn}${name}`;
      if (s.length >= 3 && s.length <= 20) suggestions.add(s);
    }
  }

  // just the name
  if (name.length >= 3 && name.length <= 20) suggestions.add(name);

  // Shuffle and return 4
  const arr = Array.from(suggestions);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, 4);
}

export default function StepBotEmail({
  currentUsername,
  currentBotName,
  onNext,
  onBack,
}: StepBotEmailProps) {
  const [botName, setBotName] = useState(currentBotName || "");
  const [username, setUsername] = useState(currentUsername);
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<{
    available: boolean;
    reason?: string;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [shuffleIndex, setShuffleIndex] = useState(0);

  // Get visible quick picks (rotate through curated names)
  const visibleQuickPicks = useMemo(() => {
    const start = (shuffleIndex * 6) % CURATED_NAMES.length;
    const picks: string[] = [];
    for (let i = 0; i < 6; i++) {
      picks.push(CURATED_NAMES[(start + i) % CURATED_NAMES.length]);
    }
    return picks;
  }, [shuffleIndex]);

  // Generate email suggestions when bot name changes
  useEffect(() => {
    if (botName.trim().length >= 2) {
      setSuggestions(generateEmailSuggestions(botName));
    } else {
      setSuggestions([]);
    }
  }, [botName]);

  // Debounced availability check
  const checkAvailability = useCallback(
    async (name: string) => {
      if (name === currentUsername) {
        setAvailability({ available: true });
        setChecking(false);
        return;
      }
      if (name.length < 3) {
        setAvailability({
          available: false,
          reason: "Must be at least 3 characters",
        });
        setChecking(false);
        return;
      }
      if (!/^[a-z0-9_-]{3,20}$/.test(name)) {
        setAvailability({
          available: false,
          reason: "Only lowercase letters, numbers, - and _",
        });
        setChecking(false);
        return;
      }

      try {
        const res = await fetch("/api/onboarding/check-username", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: name }),
        });
        const data = await res.json();
        setAvailability(data);
      } catch {
        setAvailability(null);
      }
      setChecking(false);
    },
    [currentUsername]
  );

  useEffect(() => {
    if (!username.trim()) {
      setAvailability(null);
      return;
    }
    setChecking(true);
    const timer = setTimeout(
      () => checkAvailability(username.trim().toLowerCase()),
      400
    );
    return () => clearTimeout(timer);
  }, [username, checkAvailability]);

  const handleSuggestionClick = (suggestion: string) => {
    setUsername(suggestion);
  };

  const reshuffleSuggestions = () => {
    setSuggestions(generateEmailSuggestions(botName));
  };

  const isValid = availability?.available === true && botName.trim().length >= 1;
  const showEmailSection = botName.trim().length >= 2;

  return (
    <div className="flex flex-col items-center max-w-lg mx-auto px-6">
      {/* Section 1: Name Your AI */}
      <FadeIn>
        <h2 className="text-3xl font-bold text-stone-900 mb-2 text-center">
          Name Your AI
        </h2>
        <p className="text-stone-500 mb-6 text-center">
          Give your assistant a name — it&apos;ll be yours
        </p>
      </FadeIn>

      <FadeIn delay={0.1} className="w-full">
        <div className="w-full space-y-3 mb-4">
          <Input
            value={botName}
            onChange={(e) =>
              setBotName(e.target.value.replace(/[^a-zA-Z0-9 '-]/g, "").slice(0, 30))
            }
            placeholder="e.g. Aria, Nova, Atlas..."
            className="text-lg text-center font-medium"
            maxLength={30}
          />
        </div>
      </FadeIn>

      {/* Quick picks */}
      <FadeIn delay={0.15} className="w-full">
        <div className="flex flex-wrap gap-2 justify-center mb-2">
          <AnimatePresence mode="popLayout">
            {visibleQuickPicks.map((name) => (
              <motion.button
                key={name}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={springs.micro}
                onClick={() => setBotName(name)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  botName === name
                    ? "bg-stone-900 text-white border-stone-900"
                    : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"
                }`}
              >
                {name}
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
        <button
          onClick={() => setShuffleIndex((i) => i + 1)}
          className="block mx-auto text-sm text-stone-500 hover:text-stone-700 transition-colors mb-6"
        >
          Shuffle names
        </button>
      </FadeIn>

      {/* Section 2: Choose an Email (reveals after bot name >= 2 chars) */}
      <AnimatePresence>
        {showEmailSection && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.default}
            className="w-full overflow-hidden"
          >
            <FadeIn delay={0.05}>
              <GlassCard className="w-full p-6 mb-4">
                <div className="flex items-baseline justify-center gap-1 flex-wrap">
                  <span className="text-2xl md:text-3xl font-mono font-bold text-stone-900">
                    {username || "..."}
                  </span>
                  <span className="text-2xl md:text-3xl font-mono text-stone-500">
                    @aevoy.com
                  </span>
                </div>
              </GlassCard>
            </FadeIn>

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center mb-3">
                {suggestions.map((s) => (
                  <motion.button
                    key={s}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={springs.micro}
                    onClick={() => handleSuggestionClick(s)}
                    className={`px-3 py-1 rounded-lg text-sm font-mono border transition-colors ${
                      username === s
                        ? "bg-stone-900 text-white border-stone-900"
                        : "bg-stone-50 text-stone-600 border-stone-200 hover:border-stone-400"
                    }`}
                  >
                    {s}
                  </motion.button>
                ))}
                <button
                  onClick={reshuffleSuggestions}
                  className="px-3 py-1 rounded-lg text-sm text-stone-500 hover:text-stone-700 border border-dashed border-stone-200 hover:border-stone-400 transition-colors"
                >
                  More
                </button>
              </div>
            )}

            {/* Custom prefix input */}
            <div className="w-full space-y-2 mb-4">
              <Label htmlFor="email-prefix" className="text-stone-600">
                Or type your own
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="email-prefix"
                  value={username}
                  onChange={(e) =>
                    setUsername(
                      e.target.value.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase()
                    )
                  }
                  placeholder="your-prefix"
                  className="font-mono text-lg"
                  maxLength={20}
                />
                <span className="text-stone-500 font-mono whitespace-nowrap">
                  @aevoy.com
                </span>
              </div>

              {/* Availability indicator */}
              <div className="h-5">
                {checking && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
                    <p className="text-sm text-stone-400">
                      Checking availability...
                    </p>
                  </div>
                )}
                {!checking && availability && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={springs.micro}
                    className="flex items-center gap-1.5"
                  >
                    {availability.available ? (
                      <>
                        <motion.svg
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={springs.bouncy}
                          className="w-4 h-4 text-green-500"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m4.5 12.75 6 6 9-13.5"
                          />
                        </motion.svg>
                        <p className="text-sm text-green-600">Available!</p>
                      </>
                    ) : (
                      <p className="text-sm text-red-500">
                        {availability.reason}
                      </p>
                    )}
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex gap-4 w-full mt-2">
        <Button variant="outline" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button
          onClick={() => onNext(username, botName.trim())}
          disabled={!isValid}
          className="flex-1"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
