"use client";
import { Suspense } from "react";
import { SendTaskInput } from "@/components/send-task-input";

export function SendTaskWidget() {
  return (
    <div className="w-full">
      <Suspense fallback={<div className="h-24 animate-pulse bg-muted/40 rounded-2xl" />}>
        <SendTaskInput />
      </Suspense>
    </div>
  );
}
