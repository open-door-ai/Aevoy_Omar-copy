"use client";

import React from "react";
import { AnimatePresence, ModalOverlay } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Dialog context for managing open/close state
interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue | undefined>(undefined);

function useDialogContext() {
  const context = React.useContext(DialogContext);
  if (!context) {
    throw new Error("Dialog components must be used within Dialog");
  }
  return context;
}

// Main Dialog component
interface DialogProps {
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Dialog({ children, open, onOpenChange }: DialogProps) {
  return (
    <DialogContext.Provider value={{ open, setOpen: onOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

// Dialog trigger button
interface DialogTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

export function DialogTrigger({ children, asChild }: DialogTriggerProps) {
  const { setOpen } = useDialogContext();

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, {
      onClick: () => setOpen(true),
    } as any);
  }

  return (
    <button onClick={() => setOpen(true)} type="button">
      {children}
    </button>
  );
}

// Dialog content (the actual modal)
interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  showClose?: boolean;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  full: "max-w-full mx-4",
};

export function DialogContent({
  children,
  className,
  size = "md",
  showClose = true,
}: DialogContentProps) {
  const { open, setOpen } = useDialogContext();

  return (
    <AnimatePresence>
      {open && (
        <ModalOverlay onClose={() => setOpen(false)}>
          <div
            className={cn(
              "w-full bg-card rounded-2xl shadow-xl",
              "border border-border",
              sizeClasses[size],
              className
            )}
          >
            {showClose && (
              <button
                onClick={() => setOpen(false)}
                className={cn(
                  "absolute top-4 right-4 z-20",
                  "text-muted-foreground hover:text-foreground",
                  "transition-colors duration-200",
                  "rounded-lg p-1 hover:bg-accent"
                )}
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            )}
            {children}
          </div>
        </ModalOverlay>
      )}
    </AnimatePresence>
  );
}

// Dialog header
interface DialogHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogHeader({ children, className }: DialogHeaderProps) {
  return (
    <div
      className={cn(
        "px-6 pt-6 pb-4 border-b border-stone-200 dark:border-stone-700",
        className
      )}
    >
      {children}
    </div>
  );
}

// Dialog title
interface DialogTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogTitle({ children, className }: DialogTitleProps) {
  return (
    <h2
      className={cn(
        "text-xl font-semibold text-foreground",
        className
      )}
    >
      {children}
    </h2>
  );
}

// Dialog description
interface DialogDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogDescription({ children, className }: DialogDescriptionProps) {
  return (
    <p
      className={cn(
        "mt-2 text-sm text-muted-foreground",
        className
      )}
    >
      {children}
    </p>
  );
}

// Dialog body
interface DialogBodyProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogBody({ children, className }: DialogBodyProps) {
  return (
    <div className={cn("px-6 py-4", className)}>
      {children}
    </div>
  );
}

// Dialog footer
interface DialogFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogFooter({ children, className }: DialogFooterProps) {
  return (
    <div
      className={cn(
        "px-6 py-4 border-t border-stone-200 dark:border-stone-700",
        "flex items-center justify-end gap-3",
        className
      )}
    >
      {children}
    </div>
  );
}

// Dialog close button (convenience component)
interface DialogCloseProps {
  children?: React.ReactNode;
  variant?: "default" | "outline" | "ghost";
}

export function DialogClose({ children = "Close", variant = "outline" }: DialogCloseProps) {
  const { setOpen } = useDialogContext();

  return (
    <Button variant={variant} onClick={() => setOpen(false)}>
      {children}
    </Button>
  );
}
