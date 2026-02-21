"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Star, Download, ArrowLeft, Check, ExternalLink, Flag, Shield } from "lucide-react";
import Link from "next/link";

interface AppDetail {
  id: string; name: string; slug: string; description: string; long_description: string | null;
  icon_url: string | null; screenshots: Array<{url: string; caption: string}>;
  category_id: string; tags: string[]; version: string; price_type: string; price_cents: number;
  install_count: number; rating_avg: number; rating_count: number;
  is_featured: boolean; is_builtin: boolean; widget_manifest: unknown;
  created_at: string; updated_at: string;
  developer: { id: string; bio: string | null; website: string | null };
}

interface Review { id: string; rating: number; comment: string | null; created_at: string; user_id: string; }

export default function AppDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const [app, setApp] = useState<AppDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/store/apps/${slug}`);
      if (res.ok) {
        const data = await res.json();
        setApp(data.app);
        setReviews(data.reviews || []);
        setIsInstalled(data.isInstalled);
      }
      setLoading(false);
    })();
  }, [slug]);

  const handleInstall = async () => {
    if (!app) return;
    setInstalling(true);
    const res = await fetch("/api/store/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: app.id }),
    });
    if (res.ok) setIsInstalled(true);
    setInstalling(false);
  };

  const handleUninstall = async () => {
    if (!app) return;
    await fetch("/api/store/install", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: app.id }),
    });
    setIsInstalled(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  if (!app) return <div className="min-h-screen flex items-center justify-center"><div className="text-center"><p className="text-lg font-medium mb-2">App not found</p><Link href="/store" className="text-sm text-primary hover:underline">Back to Store</Link></div></div>;

  const price = app.price_type === "free" ? "Free" : `$${(app.price_cents / 100).toFixed(2)}${app.price_type === "monthly" ? "/mo" : ""}`;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          {/* App header */}
          <div className="flex items-start gap-5">
            <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center text-3xl shrink-0 border border-border">
              {app.icon_url ? <img src={app.icon_url} alt="" className="w-14 h-14 rounded-lg" /> : "📦"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold">{app.name}</h1>
                  <p className="text-sm text-muted-foreground mt-1">{app.description}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center gap-1"><Star className="h-4 w-4 text-amber-400 fill-amber-400" /><span className="text-sm font-medium">{app.rating_avg > 0 ? app.rating_avg.toFixed(1) : "—"}</span><span className="text-xs text-muted-foreground">({app.rating_count} reviews)</span></div>
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Download className="h-3 w-3" />{app.install_count} installs</span>
                    <span className="text-xs text-muted-foreground">v{app.version}</span>
                    {app.is_builtin && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium flex items-center gap-1"><Shield className="h-3 w-3" /> Official</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className="text-lg font-bold">{price}</span>
                  {isInstalled ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-green-600 flex items-center gap-1"><Check className="h-4 w-4" /> Installed</span>
                      <button onClick={handleUninstall} className="text-xs text-muted-foreground hover:text-red-600 transition-colors">Uninstall</button>
                    </div>
                  ) : (
                    <button onClick={handleInstall} disabled={installing} className="bg-primary text-primary-foreground px-6 py-2 rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                      {installing ? "Installing..." : app.price_type === "free" ? "Install" : `Buy ${price}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Screenshots */}
          {app.screenshots && app.screenshots.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Screenshots</h2>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {app.screenshots.map((ss, i) => (
                  <div key={i} className="shrink-0 w-72 rounded-xl overflow-hidden border border-border">
                    <img src={ss.url} alt={ss.caption || `Screenshot ${i+1}`} className="w-full h-auto" />
                    {ss.caption && <p className="text-xs text-muted-foreground p-2">{ss.caption}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">About</h2>
            <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground">
              <p>{app.long_description || app.description}</p>
            </div>
            {app.tags && app.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {app.tags.map(tag => <span key={tag} className="text-xs bg-muted px-2 py-0.5 rounded-full">{tag}</span>)}
              </div>
            )}
          </div>

          {/* Reviews */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold">Reviews ({reviews.length})</h2>
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reviews yet. {isInstalled ? "Be the first to leave one!" : "Install to review."}</p>
            ) : (
              <div className="space-y-3">
                {reviews.map(r => (
                  <div key={r.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex">{[1,2,3,4,5].map(n => <Star key={n} className={`h-3 w-3 ${n <= r.rating ? "text-amber-400 fill-amber-400" : "text-muted"}`} />)}</div>
                      <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    {r.comment && <p className="text-sm text-muted-foreground">{r.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-border">
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Flag className="h-3 w-3" /> Report this app
            </button>
            {app.developer?.website && (
              <a href={app.developer.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                Developer website <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
