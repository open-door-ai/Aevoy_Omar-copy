"use client";

import React, { createContext, useContext, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, springs } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

// Tabs context
interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  variant: "default" | "pills" | "underline";
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within Tabs");
  }
  return context;
}

// Main Tabs component
interface TabsProps {
  children: React.ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  variant?: "default" | "pills" | "underline";
  className?: string;
}

export function Tabs({
  children,
  value,
  onValueChange,
  variant = "default",
  className,
}: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange, variant }}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

// TabsList — container for tab triggers
interface TabsListProps {
  children: React.ReactNode;
  className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  const { variant } = useTabsContext();
  const [indicatorProps, setIndicatorProps] = useState({ width: 0, left: 0 });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Calculate indicator position
    const updateIndicator = () => {
      if (!listRef.current) return;
      const activeTab = listRef.current.querySelector('[data-state="active"]') as HTMLElement;
      if (activeTab) {
        setIndicatorProps({
          width: activeTab.offsetWidth,
          left: activeTab.offsetLeft,
        });
      }
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [children]);

  if (variant === "pills") {
    return (
      <div
        ref={listRef}
        className={cn(
          "inline-flex items-center gap-1 p-1 bg-muted rounded-xl",
          className
        )}
      >
        {children}
      </div>
    );
  }

  if (variant === "underline") {
    return (
      <div
        ref={listRef}
        className={cn("relative flex items-center gap-6 border-b border-border", className)}
      >
        {children}
        {/* Animated underline indicator */}
        <motion.div
          className="absolute bottom-0 h-0.5 bg-foreground"
          initial={false}
          animate={indicatorProps}
          transition={springs.snappy}
        />
      </div>
    );
  }

  // Default variant
  return (
    <div
      ref={listRef}
      className={cn(
        "inline-flex items-center gap-2 p-1 bg-muted rounded-lg relative",
        className
      )}
    >
      {children}
      {/* Animated background indicator */}
      <motion.div
        className="absolute bg-card rounded-md shadow-sm"
        style={{ height: "calc(100% - 8px)", top: 4 }}
        initial={false}
        animate={indicatorProps}
        transition={springs.snappy}
      />
    </div>
  );
}

// TabsTrigger — individual tab button
interface TabsTriggerProps {
  children: React.ReactNode;
  value: string;
  className?: string;
  disabled?: boolean;
}

export function TabsTrigger({ children, value, className, disabled }: TabsTriggerProps) {
  const { value: selectedValue, setValue, variant } = useTabsContext();
  const isActive = selectedValue === value;

  const handleClick = () => {
    if (!disabled) {
      setValue(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  if (variant === "pills") {
    return (
      <button
        role="tab"
        aria-selected={isActive}
        data-state={isActive ? "active" : "inactive"}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative px-4 py-2 text-sm font-medium rounded-lg transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isActive
            ? "bg-card text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
      >
        {children}
      </button>
    );
  }

  if (variant === "underline") {
    return (
      <button
        role="tab"
        aria-selected={isActive}
        data-state={isActive ? "active" : "inactive"}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative px-1 py-3 text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isActive
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
      >
        {children}
      </button>
    );
  }

  // Default variant
  return (
    <button
      role="tab"
      aria-selected={isActive}
      data-state={isActive ? "active" : "inactive"}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative z-10 px-4 py-2 text-sm font-medium rounded-md transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isActive
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}

// TabsContent — content panel for each tab
interface TabsContentProps {
  children: React.ReactNode;
  value: string;
  className?: string;
}

export function TabsContent({ children, value, className }: TabsContentProps) {
  const { value: selectedValue } = useTabsContext();
  const isActive = selectedValue === value;

  return (
    <AnimatePresence mode="wait">
      {isActive && (
        <motion.div
          key={value}
          role="tabpanel"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={cn("mt-6", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
