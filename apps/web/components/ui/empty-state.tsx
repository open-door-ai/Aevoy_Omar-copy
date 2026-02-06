"use client";

import React from "react";
import { FadeIn } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <FadeIn delay={0.2} className={cn("text-center py-12 px-6", className)}>
      {/* Icon with float animation */}
      {Icon && (
        <div className="flex justify-center mb-4">
          <div className="p-4 bg-stone-100 dark:bg-stone-800 rounded-2xl animate-float">
            <Icon className="w-10 h-10 text-stone-400 dark:text-stone-500" />
          </div>
        </div>
      )}

      {/* Title */}
      <h3 className="text-lg font-semibold text-stone-900 dark:text-white mb-2">
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p className="text-sm text-stone-500 dark:text-stone-400 max-w-md mx-auto mb-6">
          {description}
        </p>
      )}

      {/* Actions */}
      {(action || secondaryAction) && (
        <div className="flex items-center justify-center gap-3">
          {action && (
            <Button onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="outline" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </FadeIn>
  );
}
