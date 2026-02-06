"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence, springs } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, AlertCircle, Info, X } from "lucide-react";

// Toast types
export type ToastVariant = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, variant?: ToastVariant, duration?: number) => void;
  removeToast: (id: string) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// Hook to use toast
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

// Toast Provider
interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "info", duration: number = 5000) => {
      const id = Math.random().toString(36).substring(7);
      const toast: Toast = { id, message, variant, duration };

      setToasts((prev) => [...prev, toast]);

      // Auto-dismiss after duration
      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback(
    (message: string, duration?: number) => addToast(message, "success", duration),
    [addToast]
  );

  const error = useCallback(
    (message: string, duration?: number) => addToast(message, "error", duration),
    [addToast]
  );

  const warning = useCallback(
    (message: string, duration?: number) => addToast(message, "warning", duration),
    [addToast]
  );

  const info = useCallback(
    (message: string, duration?: number) => addToast(message, "info", duration),
    [addToast]
  );

  return (
    <ToastContext.Provider
      value={{ toasts, addToast, removeToast, success, error, warning, info }}
    >
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
}

// Toast Container (renders all toasts)
function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="sync">
        {toasts.map((toast, index) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            index={index}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

// Individual Toast Item
interface ToastItemProps {
  toast: Toast;
  index: number;
  onClose: () => void;
}

const toastVariantStyles = {
  success: {
    bg: "bg-green-50 dark:bg-green-950/30",
    border: "border-green-200 dark:border-green-800",
    text: "text-green-800 dark:text-green-200",
    icon: CheckCircle2,
    iconColor: "text-green-600 dark:text-green-400",
  },
  error: {
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-800",
    text: "text-red-800 dark:text-red-200",
    icon: XCircle,
    iconColor: "text-red-600 dark:text-red-400",
  },
  warning: {
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
    border: "border-yellow-200 dark:border-yellow-800",
    text: "text-yellow-800 dark:text-yellow-200",
    icon: AlertCircle,
    iconColor: "text-yellow-600 dark:text-yellow-400",
  },
  info: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
    text: "text-blue-800 dark:text-blue-200",
    icon: Info,
    iconColor: "text-blue-600 dark:text-blue-400",
  },
};

function ToastItem({ toast, index, onClose }: ToastItemProps) {
  const { bg, border, text, icon: Icon, iconColor } = toastVariantStyles[toast.variant];

  return (
    <motion.div
      initial={{ x: 400, opacity: 0, scale: 0.95 }}
      animate={{ x: 0, opacity: 1, scale: 1 }}
      exit={{ x: 400, opacity: 0, scale: 0.95 }}
      transition={springs.default}
      style={{ zIndex: 1000 - index }}
      className={cn(
        "pointer-events-auto flex items-start gap-3 p-4 rounded-xl shadow-lg border",
        "min-w-[320px] max-w-[420px]",
        bg,
        border
      )}
    >
      {/* Icon */}
      <Icon className={cn("w-5 h-5 flex-shrink-0 mt-0.5", iconColor)} />

      {/* Message */}
      <p className={cn("flex-1 text-sm font-medium", text)}>{toast.message}</p>

      {/* Close button */}
      <button
        onClick={onClose}
        className={cn(
          "flex-shrink-0 rounded-lg p-1 transition-colors",
          "hover:bg-black/5 dark:hover:bg-white/5",
          text
        )}
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

// Standalone toast function (for use outside components)
let addToastFn: ((message: string, variant?: ToastVariant, duration?: number) => void) | null = null;

export function registerToast(fn: (message: string, variant?: ToastVariant, duration?: number) => void) {
  addToastFn = fn;
}

export const toast = {
  success: (message: string, duration?: number) => addToastFn?.(message, "success", duration),
  error: (message: string, duration?: number) => addToastFn?.(message, "error", duration),
  warning: (message: string, duration?: number) => addToastFn?.(message, "warning", duration),
  info: (message: string, duration?: number) => addToastFn?.(message, "info", duration),
};
