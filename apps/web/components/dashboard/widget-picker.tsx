"use client";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Plus } from "lucide-react";
import { BUILTIN_WIDGETS, CATEGORY_LABELS } from "@/lib/widgets/registry";
import type { WidgetLayoutItem } from "@/lib/widgets/default-layout";

interface WidgetPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (item: Omit<WidgetLayoutItem, "id">) => void;
  currentWidgetIds: string[];
}

const CATEGORIES = ["all", "productivity", "analytics", "communication"];

export function WidgetPicker({ isOpen, onClose, onAdd, currentWidgetIds }: WidgetPickerProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const filtered = useMemo(() => {
    return BUILTIN_WIDGETS.filter(w => {
      const matchesSearch = !search || w.name.toLowerCase().includes(search.toLowerCase()) || w.description.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = activeCategory === "all" || w.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [search, activeCategory]);

  const handleAdd = (widgetId: string) => {
    const def = BUILTIN_WIDGETS.find(w => w.id === widgetId);
    if (!def) return;
    onAdd({ widgetId, w: def.defaultW, h: def.defaultH, visible: true });
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed inset-x-3 bottom-3 md:inset-auto md:right-6 md:bottom-24 md:w-[420px] bg-background border border-border rounded-2xl shadow-2xl z-50 overflow-hidden max-h-[80vh] md:max-h-[70vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h2 className="font-semibold text-base">Add Widget</h2>
                <p className="text-xs text-muted-foreground">Customize your dashboard</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors"><X className="h-4 w-4" /></button>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search widgets..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-muted rounded-lg border-0 outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {/* Category tabs */}
            <div className="flex gap-1 px-3 pt-3 overflow-x-auto pb-0 shrink-0">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${activeCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"}`}
                >
                  {cat === "all" ? "All" : CATEGORY_LABELS[cat] || cat}
                </button>
              ))}
            </div>

            {/* Widget list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filtered.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">No widgets match your search</div>
              ) : filtered.map(w => {
                const isAdded = currentWidgetIds.includes(w.id);
                return (
                  <motion.div
                    key={w.id}
                    layout
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${isAdded ? "bg-muted/50 border-border/50" : "bg-card border-border hover:border-primary/30 hover:bg-primary/5"}`}
                  >
                    <div className="text-2xl w-10 h-10 flex items-center justify-center bg-muted rounded-xl shrink-0">{w.icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{w.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{w.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{w.defaultW}×{w.defaultH}</span>
                        <span className="text-[10px] text-muted-foreground capitalize">{CATEGORY_LABELS[w.category] || w.category}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => !isAdded && handleAdd(w.id)}
                      disabled={isAdded}
                      className={`shrink-0 p-2 rounded-lg transition-colors ${isAdded ? "text-muted-foreground cursor-default" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
                    >
                      {isAdded ? <span className="text-xs px-1">Added</span> : <Plus className="h-4 w-4" />}
                    </button>
                  </motion.div>
                );
              })}

              {/* Store CTA */}
              <div className="border border-dashed border-border rounded-xl p-3 text-center mt-2">
                <p className="text-xs text-muted-foreground">More widgets coming soon</p>
                <a href="/store" className="text-xs text-primary hover:underline mt-1 block">Browse the App Store →</a>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
