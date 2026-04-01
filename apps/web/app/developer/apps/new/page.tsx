"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Upload, Code2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const CATEGORIES = [
  { id: "productivity", label: "Productivity" },
  { id: "finance", label: "Finance" },
  { id: "health", label: "Health & Fitness" },
  { id: "communication", label: "Communication" },
  { id: "analytics", label: "Analytics" },
  { id: "ai-tools", label: "AI Tools" },
];

const SIZE_OPTIONS = [
  { value: "1x1", label: "1×1 Small" },
  { value: "2x1", label: "2×1 Wide" },
  { value: "2x2", label: "2×2 Large" },
  { value: "4x1", label: "4×1 Full Width" },
];

const STEPS = ["Basic Info", "Widget Config", "Upload Code", "Pricing", "Review & Submit"];

export default function NewAppPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", longDescription: "", category: "productivity", tags: "",
    size: "2x1", permissions: [] as string[],
    priceType: "free", priceCents: 0,
    codeFile: null as File | null,
  });

  const updateForm = (patch: Partial<typeof form>) => setForm(prev => ({ ...prev, ...patch }));

  const canNext = () => {
    if (step === 0) return form.name.trim() && form.description.trim();
    if (step === 1) return true;
    if (step === 2) return true; // code upload optional
    if (step === 3) return true;
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    // Step 1: Create app
    const createRes = await fetch("/api/developer/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name, description: form.description,
        category_id: form.category,
        tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
        price_type: form.priceType, price_cents: form.priceCents,
      }),
    });
    if (!createRes.ok) { setSubmitting(false); alert("Failed to create app"); return; }
    const { app } = await createRes.json();

    // Step 2: Update with long description and widget manifest
    await fetch(`/api/developer/apps/${app.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        long_description: form.longDescription,
        widget_manifest: { size: form.size, permissions: form.permissions },
      }),
    });

    // Step 3: Submit for review
    await fetch("/api/developer/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: app.id, version: "1.0.0",
        manifest: { size: form.size, permissions: form.permissions },
      }),
    });

    router.push(`/developer/apps/${app.id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <button onClick={() => router.push("/developer")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Developer Portal
        </button>

        <h1 className="text-2xl font-bold mb-2 flex items-center gap-2"><Code2 className="h-6 w-6" /> Submit New App</h1>

        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-8 mt-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className={`h-1.5 rounded-full flex-1 transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mb-6">Step {step + 1} of {STEPS.length}: <span className="font-medium text-foreground">{STEPS[step]}</span></p>

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
            <Card>
              <CardContent className="p-6 space-y-4">
                {step === 0 && (<>
                  <div><label className="text-sm font-medium mb-1 block">App Name *</label><input value={form.name} onChange={e => updateForm({ name: e.target.value })} placeholder="My Awesome Widget" className="w-full p-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20" maxLength={100} /></div>
                  <div><label className="text-sm font-medium mb-1 block">Short Description *</label><textarea value={form.description} onChange={e => updateForm({ description: e.target.value })} placeholder="A brief description of what your widget does..." className="w-full p-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20 resize-none h-20" maxLength={500} /></div>
                  <div><label className="text-sm font-medium mb-1 block">Long Description</label><textarea value={form.longDescription} onChange={e => updateForm({ longDescription: e.target.value })} placeholder="Detailed description, features, changelog..." className="w-full p-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20 resize-none h-32" maxLength={5000} /></div>
                  <div><label className="text-sm font-medium mb-1 block">Category</label>
                    <div className="grid grid-cols-2 gap-2">{CATEGORIES.map(c => (<button key={c.id} onClick={() => updateForm({ category: c.id })} className={`p-2 rounded-lg border text-sm text-left transition-colors ${form.category === c.id ? "border-primary bg-primary/5 font-medium" : "border-border hover:border-primary/30"}`}>{c.label}</button>))}</div>
                  </div>
                  <div><label className="text-sm font-medium mb-1 block">Tags (comma-separated)</label><input value={form.tags} onChange={e => updateForm({ tags: e.target.value })} placeholder="dashboard, tracker, productivity" className="w-full p-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20" /></div>
                </>)}

                {step === 1 && (<>
                  <div><label className="text-sm font-medium mb-2 block">Widget Size</label>
                    <div className="grid grid-cols-2 gap-2">{SIZE_OPTIONS.map(s => (<button key={s.value} onClick={() => updateForm({ size: s.value })} className={`p-3 rounded-lg border text-sm transition-colors ${form.size === s.value ? "border-primary bg-primary/5 font-medium" : "border-border hover:border-primary/30"}`}>{s.label}</button>))}</div>
                  </div>
                  <div><label className="text-sm font-medium mb-2 block">Permissions Required</label>
                    <div className="space-y-2">{["profile", "tasks", "usage", "health", "inbox"].map(p => (
                      <label key={p} className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.permissions.includes(p)} onChange={e => { const next = e.target.checked ? [...form.permissions, p] : form.permissions.filter(x => x !== p); updateForm({ permissions: next }); }} className="rounded border-border" /><span className="text-sm capitalize">{p}</span></label>
                    ))}</div>
                  </div>
                </>)}

                {step === 2 && (<>
                  <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
                    <Upload className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium mb-1">Upload Widget Code</p>
                    <p className="text-xs text-muted-foreground mb-4">Zip file containing manifest.json + widget.tsx (max 5MB)</p>
                    <label className="inline-flex items-center gap-2 bg-muted px-4 py-2 rounded-lg text-sm cursor-pointer hover:bg-muted/80 transition-colors">
                      <Upload className="h-4 w-4" /> Choose File
                      <input type="file" accept=".zip" className="hidden" onChange={e => updateForm({ codeFile: e.target.files?.[0] || null })} />
                    </label>
                    {form.codeFile && <p className="text-xs text-green-600 mt-2 flex items-center justify-center gap-1"><Check className="h-3 w-3" /> {form.codeFile.name}</p>}
                  </div>
                  <p className="text-xs text-amber-600 dark:text-amber-400">Code upload is optional. You can submit metadata-only and add code later.</p>
                </>)}

                {step === 3 && (<>
                  <div><label className="text-sm font-medium mb-2 block">Pricing Model</label>
                    <div className="grid grid-cols-3 gap-2">{[
                      { value: "free", label: "Free" },
                      { value: "one_time", label: "One-Time" },
                      { value: "monthly", label: "Monthly" },
                    ].map(p => (<button key={p.value} onClick={() => updateForm({ priceType: p.value })} className={`p-3 rounded-lg border text-sm transition-colors ${form.priceType === p.value ? "border-primary bg-primary/5 font-medium" : "border-border hover:border-primary/30"}`}>{p.label}</button>))}</div>
                  </div>
                  {form.priceType !== "free" && (
                    <div><label className="text-sm font-medium mb-1 block">Price (USD)</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span><input type="number" min={0} step={0.01} value={(form.priceCents / 100).toFixed(2)} onChange={e => updateForm({ priceCents: Math.round(parseFloat(e.target.value || "0") * 100) })} className="w-full pl-7 p-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20" /></div>
                      <p className="text-xs text-muted-foreground mt-1">You earn 70% — Anticipy takes 30% platform fee</p>
                    </div>
                  )}
                </>)}

                {step === 4 && (<>
                  <div className="space-y-3">
                    <h3 className="font-semibold text-sm">Review Summary</h3>
                    <div className="grid grid-cols-2 gap-y-2 text-sm">
                      <span className="text-muted-foreground">Name</span><span className="font-medium">{form.name}</span>
                      <span className="text-muted-foreground">Category</span><span className="font-medium capitalize">{form.category}</span>
                      <span className="text-muted-foreground">Widget Size</span><span className="font-medium">{form.size}</span>
                      <span className="text-muted-foreground">Price</span><span className="font-medium">{form.priceType === "free" ? "Free" : `$${(form.priceCents / 100).toFixed(2)} ${form.priceType === "monthly" ? "/mo" : ""}`}</span>
                      <span className="text-muted-foreground">Code</span><span className="font-medium">{form.codeFile ? form.codeFile.name : "None (metadata only)"}</span>
                    </div>
                  </div>
                  <div className="border border-border rounded-xl p-4 bg-muted/30 space-y-2">
                    <p className="text-sm font-medium">Estimated Review Cost</p>
                    <p className="text-2xl font-bold">$5.00</p>
                    <p className="text-xs text-muted-foreground">AI security review by Opus 4.6 — billed after review completes</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Review fees are currently waived</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" className="rounded border-border" /><span className="text-xs text-muted-foreground">I consent to the review process and agree to the developer terms</span></label>
                </>)}
              </CardContent>
            </Card>
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button onClick={() => step > 0 && setStep(step - 1)} disabled={step === 0} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={() => canNext() && setStep(step + 1)} disabled={!canNext()} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-5 py-2 rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              Next <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={submitting} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-5 py-2 rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {submitting ? "Submitting..." : "Submit for Review"} <Check className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
