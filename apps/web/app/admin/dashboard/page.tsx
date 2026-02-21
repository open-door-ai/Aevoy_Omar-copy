"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Shield, Clock, CheckCircle, XCircle, AlertTriangle, LogOut, FileCode, Users, Package, ChevronRight } from "lucide-react";

interface Submission {
  id: string; review_status: string; version: string; submitted_at: string;
  security_flags: Array<{severity: string; type: string; description: string}>;
  billed_cost_usd: number;
  app: { id: string; name: string; slug: string; icon_url: string | null; category_id: string; price_type: string; price_cents: number };
  developer: { id: string; username: string; email: string };
}

export default function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState("queued");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ queued: 0, approved: 0, rejected: 0 });

  const loadSubmissions = useCallback(async (status: string) => {
    setLoading(true);
    const res = await fetch(`/api/admin/submissions?status=${status}`);
    if (res.status === 401) { router.push("/admin"); return; }
    if (res.ok) { const d = await res.json(); setSubmissions(d.submissions || []); }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    loadSubmissions(tab);
    // Load stats for all statuses
    Promise.all(["queued", "approved", "rejected"].map(async s => {
      const res = await fetch(`/api/admin/submissions?status=${s}`);
      if (res.ok) { const d = await res.json(); return { status: s, count: d.submissions?.length || 0 }; }
      return { status: s, count: 0 };
    })).then(results => {
      const s: Record<string, number> = {};
      results.forEach(r => { s[r.status] = r.count; });
      setStats(s as typeof stats);
    });
  }, [tab, loadSubmissions]);

  const handleAction = async (submissionId: string, action: string, notes?: string) => {
    const res = await fetch(`/api/admin/submissions/${submissionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, notes }),
    });
    if (res.ok) loadSubmissions(tab);
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin");
  };

  const SEVERITY_COLORS: Record<string, string> = {
    CRITICAL: "bg-red-500 text-white",
    HIGH: "bg-amber-500 text-white",
    MEDIUM: "bg-yellow-100 text-yellow-800",
    LOW: "bg-blue-100 text-blue-800",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-white/60" />
          <h1 className="font-semibold">Admin Dashboard</h1>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white transition-colors">
          <LogOut className="h-4 w-4" /> Logout
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Pending Review", count: stats.queued, icon: Clock, color: "text-amber-400" },
            { label: "Approved", count: stats.approved, icon: CheckCircle, color: "text-green-400" },
            { label: "Rejected", count: stats.rejected, icon: XCircle, color: "text-red-400" },
          ].map(s => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <s.icon className={`h-4 w-4 ${s.color}`} />
                <span className="text-xs text-white/40">{s.label}</span>
              </div>
              <p className="text-2xl font-bold">{s.count}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/10 pb-0">
          {["queued", "approved", "rejected", "needs_changes"].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${tab === t ? "border-white text-white" : "border-transparent text-white/40 hover:text-white/60"}`}
            >
              {t.replace("_", " ")}
            </button>
          ))}
        </div>

        {/* Submissions */}
        {loading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-white/5 animate-pulse rounded-xl" />)}</div>
        ) : submissions.length === 0 ? (
          <div className="text-center py-12 text-white/30">
            <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>No submissions with status &quot;{tab.replace("_", " ")}&quot;</p>
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.map(sub => {
              const hasHighFlags = sub.security_flags?.some(f => f.severity === "CRITICAL" || f.severity === "HIGH");
              return (
                <motion.div key={sub.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-lg">{sub.app?.icon_url ? <img src={sub.app.icon_url} alt="" className="w-7 h-7 rounded" /> : "📦"}</div>
                      <div>
                        <p className="font-semibold text-sm">{sub.app?.name || "Unknown"}</p>
                        <p className="text-xs text-white/40">by @{sub.developer?.username || "?"} · v{sub.version} · {new Date(sub.submitted_at).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {sub.app?.price_type !== "free" && (
                        <span className="text-xs bg-white/10 px-2 py-0.5 rounded">${(sub.app?.price_cents / 100).toFixed(2)}{sub.app?.price_type === "monthly" ? "/mo" : ""}</span>
                      )}
                    </div>
                  </div>

                  {/* Security flags */}
                  {sub.security_flags && sub.security_flags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {sub.security_flags.map((f, i) => (
                        <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[f.severity] || "bg-white/10 text-white/60"}`}>
                          {f.severity}: {f.type}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  {tab === "queued" && (
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={() => handleAction(sub.id, "approve")} className="flex items-center gap-1.5 bg-green-500/20 text-green-400 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-500/30 transition-colors">
                        <CheckCircle className="h-3.5 w-3.5" /> Approve
                      </button>
                      <button onClick={() => handleAction(sub.id, "reject", "Does not meet quality standards")} className="flex items-center gap-1.5 bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-500/30 transition-colors">
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </button>
                      <button onClick={() => handleAction(sub.id, "request_changes", "Please address the security flags")} className="flex items-center gap-1.5 bg-amber-500/20 text-amber-400 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-500/30 transition-colors">
                        <AlertTriangle className="h-3.5 w-3.5" /> Request Changes
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
