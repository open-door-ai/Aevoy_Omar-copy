"use client";

import { motion, AnimatePresence, type Transition } from "framer-motion";
import React from "react";
import { cn } from "@/lib/utils";

// Spring presets
export const springs = {
  micro: { type: "spring", stiffness: 500, damping: 30, mass: 0.5 } as Transition,
  default: { type: "spring", stiffness: 300, damping: 25 } as Transition,
  gentle: { type: "spring", stiffness: 200, damping: 20 } as Transition,
  bouncy: { type: "spring", stiffness: 400, damping: 15 } as Transition,
  snappy: { type: "spring", stiffness: 600, damping: 35 } as Transition,
};

// FadeIn — opacity + translateY with configurable delay/direction
interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  distance?: number;
  className?: string;
  duration?: number;
}

export function FadeIn({
  children,
  delay = 0,
  direction = "up",
  distance = 20,
  className,
  duration = 0.5,
}: FadeInProps) {
  const directionMap = {
    up: { y: distance },
    down: { y: -distance },
    left: { x: distance },
    right: { x: -distance },
    none: {},
  };

  return (
    <motion.div
      initial={{ opacity: 0, ...directionMap[direction] }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// StaggerContainer + StaggerItem
interface StaggerContainerProps {
  children: React.ReactNode;
  className?: string;
  staggerDelay?: number;
  delayStart?: number;
}

export function StaggerContainer({
  children,
  className,
  staggerDelay = 0.08,
  delayStart = 0,
}: StaggerContainerProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: staggerDelay,
            delayChildren: delayStart,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface StaggerItemProps {
  children: React.ReactNode;
  className?: string;
}

export function StaggerItem({ children, className }: StaggerItemProps) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 16 },
        visible: {
          opacity: 1,
          y: 0,
          transition: springs.default,
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ShakeOnError — triggers shake when error prop changes
interface ShakeOnErrorProps {
  children: React.ReactNode;
  error: string | null | undefined;
  className?: string;
}

export function ShakeOnError({ children, error, className }: ShakeOnErrorProps) {
  return (
    <motion.div
      key={error || "no-error"}
      animate={error ? { x: [0, -4, 4, -4, 4, 0] } : {}}
      transition={{ duration: 0.4 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// SlideIn — directional slide entrance
interface SlideInProps {
  children: React.ReactNode;
  direction?: "left" | "right" | "up" | "down";
  distance?: number;
  className?: string;
  delay?: number;
}

export function SlideIn({
  children,
  direction = "left",
  distance = 80,
  className,
  delay = 0,
}: SlideInProps) {
  const directionMap = {
    left: { x: -distance },
    right: { x: distance },
    up: { y: -distance },
    down: { y: distance },
  };

  return (
    <motion.div
      initial={directionMap[direction]}
      animate={{ x: 0, y: 0 }}
      exit={directionMap[direction]}
      transition={{ ...springs.default, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ScaleIn — scale entrance
interface ScaleInProps {
  children: React.ReactNode;
  scale?: number;
  className?: string;
  delay?: number;
}

export function ScaleIn({
  children,
  scale = 0.95,
  className,
  delay = 0,
}: ScaleInProps) {
  return (
    <motion.div
      initial={{ scale, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale, opacity: 0 }}
      transition={{ ...springs.default, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ModalOverlay — backdrop + modal wrapper
interface ModalOverlayProps {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}

export function ModalOverlay({ children, onClose, className }: ModalOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal content */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={springs.default}
        className={cn("relative z-10", className)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </div>
  );
}

// SkeletonPulse — shimmer effect skeleton
interface SkeletonPulseProps {
  className?: string;
}

export function SkeletonPulse({ className }: SkeletonPulseProps) {
  return (
    <div
      className={cn(
        "animate-shimmer bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%]",
        "dark:from-stone-800 dark:via-stone-700 dark:to-stone-800",
        "rounded",
        className
      )}
    />
  );
}

// PageTransition — route change wrapper
interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

export function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// GlassCard
interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

export function GlassCard({ children, className, ...props }: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/20 bg-white/60 backdrop-blur-xl shadow-sm",
        "dark:bg-white/5 dark:border-white/10",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// Re-export for convenience
export { motion, AnimatePresence };
