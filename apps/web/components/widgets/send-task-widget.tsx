"use client";
import { Suspense } from "react";
import { SendTaskInput } from "@/components/send-task-input";
import { SkeletonCard } from "@/components/ui/skeleton";

export function SendTaskWidget() {
  return (
    <div className="w-full">
      <Suspense fallback={<SkeletonCard />}>
        <SendTaskInput />
      </Suspense>
    </div>
  );
}
