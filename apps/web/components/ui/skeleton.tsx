"use client";

import React from "react";
import { SkeletonPulse } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

// Base skeleton component
interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <SkeletonPulse
      className={cn("h-4 w-full rounded", className)}
    />
  );
}

// SkeletonText — text line placeholders
interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-4",
            i === lines - 1 ? "w-3/4" : "w-full" // Last line shorter
          )}
        />
      ))}
    </div>
  );
}

// SkeletonAvatar — circular avatar placeholder
interface SkeletonAvatarProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const avatarSizes = {
  sm: "w-8 h-8",
  md: "w-12 h-12",
  lg: "w-16 h-16",
};

export function SkeletonAvatar({ size = "md", className }: SkeletonAvatarProps) {
  return (
    <SkeletonPulse
      className={cn("rounded-full", avatarSizes[size], className)}
    />
  );
}

// SkeletonCard — matches Card layout with shimmer
interface SkeletonCardProps {
  variant?: "default" | "stats" | "task";
  className?: string;
}

export function SkeletonCard({ variant = "default", className }: SkeletonCardProps) {
  if (variant === "stats") {
    return (
      <div className={cn("rounded-xl border border-stone-200 dark:border-stone-700 p-6", className)}>
        <Skeleton className="h-3 w-24 mb-3" />
        <Skeleton className="h-8 w-32 mb-4" />
        <Skeleton className="h-2 w-full" />
      </div>
    );
  }

  if (variant === "task") {
    return (
      <div className={cn("rounded-lg border border-stone-200 dark:border-stone-700 p-4", className)}>
        <div className="flex items-center justify-between">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </div>
    );
  }

  // Default card variant
  return (
    <div className={cn("rounded-xl border border-stone-200 dark:border-stone-700 p-6", className)}>
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <SkeletonAvatar size="sm" />
        </div>
        <SkeletonText lines={3} />
      </div>
    </div>
  );
}

// SkeletonList — staggered skeleton items
interface SkeletonListProps {
  count?: number;
  variant?: "default" | "task";
  className?: string;
}

export function SkeletonList({ count = 3, variant = "default", className }: SkeletonListProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} variant={variant} />
      ))}
    </div>
  );
}

// SkeletonTable — table rows
interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({ rows = 5, columns = 4, className }: SkeletonTableProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {/* Header row */}
      <div className="flex gap-4 pb-3 border-b border-stone-200 dark:border-stone-700">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`header-${i}`} className="h-4 w-24" />
        ))}
      </div>

      {/* Body rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={`row-${rowIndex}`} className="flex gap-4">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={`cell-${rowIndex}-${colIndex}`}
              className={cn(
                "h-4",
                colIndex === 0 ? "w-32" : colIndex === columns - 1 ? "w-20" : "w-24"
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// SkeletonButton
interface SkeletonButtonProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const buttonSizes = {
  sm: "h-8 w-20",
  md: "h-9 w-24",
  lg: "h-10 w-32",
};

export function SkeletonButton({ size = "md", className }: SkeletonButtonProps) {
  return (
    <Skeleton className={cn("rounded-md", buttonSizes[size], className)} />
  );
}

// SkeletonInput
interface SkeletonInputProps {
  className?: string;
}

export function SkeletonInput({ className }: SkeletonInputProps) {
  return (
    <Skeleton className={cn("h-9 w-full rounded-md", className)} />
  );
}
