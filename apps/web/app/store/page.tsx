"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, Star, Download, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";

interface AppListing {
  id: string; name: string; slug: string; description: string; icon_url: string | null;
  category_id: string; price_type: string; price_cents: number;
  install_count: number; rating_avg: number; rating_count: number;
  is_featured: boolean; is_builtin: boolean;
}

const CATEGORIES = [
  { id: "productivity", name: "Productivity", icon: "⚡" },
  { id: "finance", name: "Finance", icon: "💰" },
  { id: "communication", name: "Communication", icon: "💬" },
  { id: "analytics", name: "Analytics", icon: "📊" },
  { id: "ai-tools", name: "AI Tools", icon: "🤖" },
];

function PriceTag({ type, cents }: { type: string; cents: number }) {
  if (type === "free") return <span className="text-xs font-medium text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400 px-2 py-0.5 rounded-full">Free</span>;
  const dollars = (cents / 100).toFixed(2);
  return <span className="text-xs font-medium text-foreground bg-muted px-2 py-0.5 rounded-full">${dollars}{type === "monthly" ? "/mo" : ""}</span>;
}

function StarRating({ avg, count }: { avg: number; count: number }) {
  return (
    <div className="flex items-center gap-1">
      <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
      <span className="text-xs font-medium">{avg > 0 ? avg.toFixed(1) : "—"}</span>
      <span className="text-xs text-muted-foreground">({count})</span>
    </div>
  );
}

export default function StorePage() {
  const [apps, setApps] = useState<AppListing[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (search) params.set("q", search);
      params.set("sort", sort);
      params.set("limit", "24");
      const res = await fetch(`/api/store/apps?${params}`);
      if (res.ok) { const data = await res.json(); setApps(data.apps || []); }
      setLoading(false);
    })();
  }, [category, sort, search]);

  const featured = apps.filter(a => a.is_featured);
  const all = apps;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5" />
        <div className="max-w-6xl mx-auto px-6 py-16 relative">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-5 w-5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">New</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Aurora App Store</h1>
            <p className="text-lg text-muted-foreground max-w-xl mb-8">Extend your AI assistant with powerful widgets and integrations built by the community.</p>
            <div className="relative max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search apps..."
                className="w-full pl-11 pr-4 py-3 rounded-xl bg-background border border-border shadow-sm text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none transition-all"
              />
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-12">
        {/* Categories */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Categories</h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setCategory(category === cat.id ? null : cat.id)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all hover:shadow-md ${category === cat.id ? "border-primary bg-primary/5 shadow-md" : "border-border bg-card hover:border-primary/30"}`}
              >
                <span className="text-2xl">{cat.icon}</span>
                <span className="text-xs font-medium">{cat.name}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Featured */}
        {featured.length > 0 && !category && !search && (
          <section>
            <h2 className="text-lg font-semibold mb-4">Featured</h2>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 snap-x">
              {featured.map((app, i) => (
                <motion.div key={app.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Link href={`/store/${app.slug}`} className="flex-shrink-0 w-64 block border border-border/50 bg-gradient-to-br from-card to-primary/5 rounded-2xl p-5 hover:shadow-lg transition-all snap-start group">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-xl">{app.icon_url ? <img src={app.icon_url} alt="" className="w-8 h-8 rounded" /> : "📦"}</div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{app.name}</p>
                        <PriceTag type={app.price_type} cents={app.price_cents} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{app.description}</p>
                    <div className="flex items-center justify-between">
                      <StarRating avg={app.rating_avg} count={app.rating_count} />
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><Download className="h-3 w-3" /> {app.install_count}</span>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </section>
        )}

        {/* All Apps */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{category ? CATEGORIES.find(c => c.id === category)?.name || "Apps" : "All Apps"}</h2>
            <select value={sort} onChange={e => setSort(e.target.value)} className="text-xs bg-muted border-0 rounded-lg px-3 py-1.5 outline-none">
              <option value="newest">Newest</option>
              <option value="top_rated">Top Rated</option>
              <option value="most_installed">Most Installed</option>
            </select>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-40 bg-muted/40 animate-pulse rounded-xl" />)}
            </div>
          ) : all.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-2xl">
              <p className="text-lg font-medium mb-2">No apps yet</p>
              <p className="text-sm text-muted-foreground mb-4">{search ? "Try a different search" : "Be the first to publish an app!"}</p>
              <Link href="/developer" className="inline-flex items-center gap-1.5 text-sm text-primary font-medium hover:underline">Become a Developer <ArrowRight className="h-3.5 w-3.5" /></Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {all.map((app, i) => (
                <motion.div key={app.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <Link href={`/store/${app.slug}`} className="block border border-border rounded-xl p-4 hover:shadow-md hover:border-primary/20 transition-all bg-card group">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-xl shrink-0">{app.icon_url ? <img src={app.icon_url} alt="" className="w-8 h-8 rounded" /> : "📦"}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{app.name}</p>
                          <PriceTag type={app.price_type} cents={app.price_cents} />
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{app.description}</p>
                        <div className="flex items-center gap-3">
                          <StarRating avg={app.rating_avg} count={app.rating_count} />
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Download className="h-3 w-3" /> {app.install_count}</span>
                          {app.is_builtin && <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">Official</span>}
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* Developer CTA */}
        <section className="border border-border rounded-2xl p-8 bg-gradient-to-r from-primary/5 to-purple-500/5 text-center">
          <h2 className="text-xl font-bold mb-2">Build for Aurora</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">Create widgets and integrations that extend what Aurora can do. Earn 70% of revenue from paid apps.</p>
          <Link href="/developer" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">
            Start Building <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}
