"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "success" | "warning" | "danger";
  label?: React.ReactNode;
  description?: string;
  labelPosition?: "left" | "right" | "top" | "bottom";
  id?: string;
  name?: string;
  ariaLabel?: string;
}

const sizeClasses = {
  sm: {
    track: "h-5 w-9",
    thumb: "h-3.5 w-3.5",
    translate: "translate-x-4",
  },
  md: {
    track: "h-6 w-11",
    thumb: "h-4.5 w-4.5",
    translate: "translate-x-5",
  },
  lg: {
    track: "h-7 w-14",
    thumb: "h-5.5 w-5.5",
    translate: "translate-x-7",
  },
};

const variantClasses = {
  default: "bg-primary",
  success: "bg-green-500",
  warning: "bg-yellow-500",
  danger: "bg-red-500",
};

export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = "md",
  variant = "default",
  label,
  description,
  labelPosition = "right",
  id,
  name,
  ariaLabel,
}: ToggleProps) {
  const sizeConfig = sizeClasses[size];
  const activeColor = variantClasses[variant];

  const handleToggle = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      handleToggle();
    }
  };

  const toggleSwitch = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel || (typeof label === 'string' ? label : "Toggle switch")}
      disabled={disabled}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      id={id}
      name={name}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        sizeConfig.track,
        checked
          ? activeColor
          : "bg-muted dark:bg-muted/50",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <motion.span
        layout
        animate={{
          x: checked ? (size === "sm" ? 16 : size === "lg" ? 28 : 20) : 0,
        }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 30,
        }}
        className={cn(
          "pointer-events-none inline-block transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
          sizeConfig.thumb
        )}
      />
    </button>
  );

  const labelElement = (label || description) && (
    <div
      className={cn(
        "flex flex-col",
        labelPosition === "left" || labelPosition === "right" ? "gap-0.5" : "gap-1.5"
      )}
    >
      {label && (
        <label
          htmlFor={id}
          className={cn(
            "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          onClick={!disabled ? handleToggle : undefined}
        >
          {label}
        </label>
      )}
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );

  if (!label && !description) {
    return toggleSwitch;
  }

  if (labelPosition === "left") {
    return (
      <div className="flex items-center gap-3">
        {labelElement}
        {toggleSwitch}
      </div>
    );
  }

  if (labelPosition === "right") {
    return (
      <div className="flex items-center gap-3">
        {toggleSwitch}
        {labelElement}
      </div>
    );
  }

  if (labelPosition === "top") {
    return (
      <div className="flex flex-col gap-2">
        {labelElement}
        {toggleSwitch}
      </div>
    );
  }

  // bottom (default for labeled switches)
  return (
    <div className="flex flex-col gap-2">
      {toggleSwitch}
      {labelElement}
    </div>
  );
}
