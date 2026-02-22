"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import Link from "next/link";

const BUILTIN_SKILLS = [
  { name: "Web Browse", icon: "🌐", active: true },
  { name: "Send Email", icon: "📧", active: true },
  { name: "Send SMS", icon: "💬", active: true },
  { name: "Generate Image", icon: "🎨", active: true },
  { name: "Post Tweet", icon: "🐦", active: true },
  { name: "Schedule Task", icon: "📅", active: true },
];

export function SkillsWidget() {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" /> Skills
          <span className="text-xs font-normal text-muted-foreground ml-auto">{BUILTIN_SKILLS.length} active</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {BUILTIN_SKILLS.map(s => (
            <span key={s.name} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-full">
              <span>{s.icon}</span> {s.name}
            </span>
          ))}
        </div>
        <Link href="/dashboard/skills" className="text-xs text-primary hover:underline block mt-3">Manage skills →</Link>
      </CardContent>
    </Card>
  );
}
