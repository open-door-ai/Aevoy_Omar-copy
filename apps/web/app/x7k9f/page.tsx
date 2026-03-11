"use client";
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Lock, Eye, EyeOff, Loader2, AlertTriangle, Shield } from "lucide-react";
import { useRouter } from "next/navigation";

export default function PortalLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/x7k9f/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok) {
        router.push("/x7k9f/dashboard");
      } else if (data.error === "locked") {
        setLocked(true);
        setAttemptsRemaining(0);
      } else {
        setError(data.message || "Incorrect password");
        if (data.attemptsRemaining !== undefined) setAttemptsRemaining(data.attemptsRemaining);
        setPassword("");
        inputRef.current?.focus();
      }
    } catch {
      setError("Connection error");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield className="h-8 w-8 text-white/70" />
          </div>
          <h1 className="text-xl font-semibold text-white">Access Portal</h1>
          <p className="text-xs text-white/30 mt-1">Authorized personnel only</p>
        </div>

        {locked ? (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-3" />
            <p className="font-semibold text-red-400 text-sm">Access Locked</p>
            <p className="text-xs text-red-400/60 mt-1">Too many failed attempts. Try again later.</p>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                <input
                  ref={inputRef}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter access code"
                  autoComplete="current-password"
                  maxLength={128}
                  className="w-full pl-10 pr-10 py-3 text-sm bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/20 outline-none focus:border-white/30 focus:bg-white/[0.07] transition-all"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/50 transition-colors">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-400">
                {error}
                {attemptsRemaining !== null && attemptsRemaining > 0 && (
                  <span className="block mt-0.5 text-red-400/50">{attemptsRemaining} attempt{attemptsRemaining !== 1 ? "s" : ""} remaining</span>
                )}
              </motion.div>
            )}

            <button type="submit" disabled={loading || !password} className="w-full bg-white text-black py-3 rounded-xl text-sm font-medium hover:bg-white/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Verifying...</> : "Enter"}
            </button>
          </form>
        )}

        <p className="text-center text-[10px] text-white/10 mt-8">Protected by rate limiting + IP tracking</p>
      </motion.div>
    </div>
  );
}
