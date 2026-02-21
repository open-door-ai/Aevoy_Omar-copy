"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Clock, CheckCircle, XCircle, AlertTriangle, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

interface AppData {
  id: string; name: string; slug: string; description: string; status: string;
  price_type: string; price_cents: number; install_count: number; rating_avg: number;
  version: string; created_at: string;
}

interface Submission {
  id: string; version: string; review_status: string; submitted_at: string;
  reviewed_at: string | null; billed_cost_usd: number; reviewer_notes: string | null;
  security_flags: Array<{severity: string; type: string; description: string}>;
}

const STATUS_CONFIG: Record<string, {color: string; icon: React.ComponentType<{className?: string}>; label: string}> = {
  draft: { color: "text-gray-600", icon: Clock, label: "Draft" },
  pending_review: { color: "text-amber-600", icon: Clock, label: "Pending Review" },
  approved: { color: "text-green-600", icon: CheckCircle, label: "Approved" },
  rejected: { color: "text-red-600", icon: XCircle, label: "Rejected" },
  needs_changes: { color: "text-amber-600", icon: AlertTriangle, label: "Needs Changes" },
  queued: { color: "text-blue-600", icon: Clock, label: "Queued for Review" },
  scanning: { color: "text-blue-600", icon: Clock, label: "AI Scanning..." },
};

export default function ManageAppPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [app, setApp] = useState<AppData | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/developer/apps/${id}`);
      if (res.ok) { const d = await res.json(); setApp(d.app); setSubmissions(d.submissions || []); }
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  if (!app) return <div className="min-h-screen flex items-center justify-center"><p>App not found</p></div>;

  const status = STATUS_CONFIG[app.status] || STATUS_CONFIG.draft;
  const StatusIcon = status.icon;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <button onClick={() => router.push("/developer")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Developer Portal
        </button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{app.name}</h1>
            <p className="text-sm text-muted-foreground">{app.description}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs font-medium flex items-center gap-1 ${status.color}`}><StatusIcon className="h-3.5 w-3.5" /> {status.label}</span>
              <span className="text-xs text-muted-foreground">v{app.version}</span>
              <span className="text-xs text-muted-foreground">{app.install_count} installs</span>
            </div>
          </div>
          {(app.status === "draft" || app.status === "rejected") && (
            <Link href={`/developer/apps/new`} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary/90">
              <Send className="h-4 w-4" /> Resubmit
            </Link>
          )}
        </div>

        {/* Submission History */}
        <Card>
          <CardHeader><CardTitle className="text-base">Submission History</CardTitle></CardHeader>
          <CardContent>
            {submissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No submissions yet</p>
            ) : (
              <div className="space-y-4">
                {submissions.map(sub => {
                  const subStatus = STATUS_CONFIG[sub.review_status] || STATUS_CONFIG.queued;
                  const SubIcon = subStatus.icon;
                  return (
                    <div key={sub.id} className="border border-border rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium flex items-center gap-1 ${subStatus.color}`}><SubIcon className="h-3.5 w-3.5" /> {subStatus.label}</span>
                          <span className="text-xs text-muted-foreground">v{sub.version}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{new Date(sub.submitted_at).toLocaleString()}</span>
                      </div>
                      {sub.reviewer_notes && (
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs font-medium mb-1">Reviewer Notes:</p>
                          <p className="text-xs text-muted-foreground">{sub.reviewer_notes}</p>
                        </div>
                      )}
                      {sub.security_flags && sub.security_flags.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium">Security Flags:</p>
                          {sub.security_flags.map((f, i) => (
                            <div key={i} className={`text-xs px-2 py-1 rounded ${f.severity === "CRITICAL" ? "bg-red-100 text-red-700" : f.severity === "HIGH" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                              [{f.severity}] {f.type}: {f.description}
                            </div>
                          ))}
                        </div>
                      )}
                      {sub.billed_cost_usd > 0 && (
                        <p className="text-xs text-muted-foreground">Review cost: ${Number(sub.billed_cost_usd).toFixed(2)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
