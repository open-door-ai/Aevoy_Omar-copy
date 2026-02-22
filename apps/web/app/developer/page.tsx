"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Code2, CheckCircle, Clock, XCircle, Plus, ArrowRight, DollarSign, Shield, Zap, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

interface DevProfile { verified: boolean; bio: string | null; website: string | null; github_url: string | null; total_earned_cents: number; verification_paid_at: string | null; }
interface DevApp { id: string; name: string; slug: string; status: string; install_count: number; rating_avg: number; created_at: string; }

const STATUS_BADGE: Record<string, { color: string; icon: React.ComponentType<{className?: string}>; label: string }> = {
  draft: { color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", icon: Clock, label: "Draft" },
  pending_review: { color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: Clock, label: "In Review" },
  approved: { color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle, label: "Approved" },
  rejected: { color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: XCircle, label: "Rejected" },
  suspended: { color: "bg-red-100 text-red-700", icon: XCircle, label: "Suspended" },
};

export default function DeveloperPortal() {
  const [profile, setProfile] = useState<DevProfile | null>(null);
  const [apps, setApps] = useState<DevApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [github, setGithub] = useState("");
  const [step, setStep] = useState<"register" | "dashboard">("register");

  useEffect(() => {
    (async () => {
      const [profRes, appsRes] = await Promise.all([
        fetch("/api/developer/profile"),
        fetch("/api/developer/apps"),
      ]);
      if (profRes.ok) { const d = await profRes.json(); setProfile(d.profile); if (d.profile?.verified) setStep("dashboard"); }
      if (appsRes.ok) { const d = await appsRes.json(); setApps(d.apps || []); }
      setLoading(false);
    })();
  }, []);

  const handleVerify = async () => {
    setVerifying(true);
    const res = await fetch("/api/developer/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bio, website: website || undefined, github_url: github || undefined }),
    });
    if (res.ok) { setProfile({ verified: true, bio, website, github_url: github, total_earned_cents: 0, verification_paid_at: new Date().toISOString() }); setStep("dashboard"); }
    setVerifying(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  if (step === "register") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
        <div className="max-w-2xl mx-auto px-6 py-16">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4"><Code2 className="h-8 w-8 text-primary" /></div>
              <h1 className="text-3xl font-bold mb-2">Become an Aevoy Developer</h1>
              <p className="text-muted-foreground">Build widgets and integrations. Earn 70% of every sale.</p>
            </div>

            {/* Benefits */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: DollarSign, title: "70% Revenue Share", desc: "Keep the majority of your earnings" },
                { icon: Shield, title: "AI Security Review", desc: "Your code is reviewed by Opus 4.6" },
                { icon: Zap, title: "SDK & Docs", desc: "Build with our widget SDK" },
                { icon: Globe, title: "Global Distribution", desc: "Reach all Aevoy users instantly" },
              ].map(b => (
                <div key={b.title} className="border border-border rounded-xl p-4 bg-card">
                  <b.icon className="h-5 w-5 text-primary mb-2" />
                  <p className="text-sm font-semibold">{b.title}</p>
                  <p className="text-xs text-muted-foreground">{b.desc}</p>
                </div>
              ))}
            </div>

            {/* Registration form */}
            <Card>
              <CardHeader><CardTitle className="text-base">Developer Registration</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Bio</label>
                  <textarea value={bio} onChange={e => setBio(e.target.value)} placeholder="Tell us about yourself..." className="w-full p-3 rounded-lg border border-border bg-background text-sm resize-none h-20 outline-none focus:ring-2 focus:ring-primary/20" maxLength={500} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Website (optional)</label>
                  <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://yoursite.com" className="w-full p-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">GitHub (optional)</label>
                  <input value={github} onChange={e => setGithub(e.target.value)} placeholder="https://github.com/username" className="w-full p-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <div className="border border-border rounded-xl p-4 bg-muted/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Verification Fee</span>
                    <span className="text-lg font-bold">$5.00</span>
                  </div>
                  <p className="text-xs text-muted-foreground">One-time fee to verify your developer account. This helps maintain store quality.</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">Beta: Payment is waived during beta testing</p>
                </div>
                <button onClick={handleVerify} disabled={verifying || !bio.trim()} className="w-full bg-primary text-primary-foreground py-3 rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {verifying ? "Verifying..." : "Get Verified — $5.00 (Free during Beta)"}
                </button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    );
  }

  // Developer Dashboard
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Code2 className="h-6 w-6" /> Developer Portal</h1>
            <p className="text-sm text-muted-foreground">Manage your apps and submissions</p>
          </div>
          <Link href="/developer/apps/new" className="shrink-0 flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="h-4 w-4" /> New App
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="pt-4 pb-4 text-center"><p className="text-xs text-muted-foreground">Total Apps</p><p className="text-2xl font-bold">{apps.length}</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-4 text-center"><p className="text-xs text-muted-foreground">Total Installs</p><p className="text-2xl font-bold">{apps.reduce((s, a) => s + a.install_count, 0)}</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-4 text-center"><p className="text-xs text-muted-foreground">Revenue</p><p className="text-2xl font-bold">${((profile?.total_earned_cents || 0) / 100).toFixed(2)}</p></CardContent></Card>
        </div>

        {/* Apps list */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Your Apps</h2>
          {apps.length === 0 ? (
            <Card><CardContent className="py-8 text-center"><p className="text-sm text-muted-foreground mb-2">No apps yet</p><Link href="/developer/apps/new" className="text-sm text-primary hover:underline">Create your first app →</Link></CardContent></Card>
          ) : apps.map(app => {
            const badge = STATUS_BADGE[app.status] || STATUS_BADGE.draft;
            const BadgeIcon = badge.icon;
            return (
              <Link key={app.id} href={`/developer/apps/${app.id}`} className="block border border-border rounded-xl p-4 hover:shadow-md transition-all bg-card group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-lg">📦</div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm group-hover:text-primary transition-colors truncate">{app.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${badge.color}`}><BadgeIcon className="h-3 w-3" />{badge.label}</span>
                        <span className="text-[10px] text-muted-foreground">{app.install_count} installs</span>
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
