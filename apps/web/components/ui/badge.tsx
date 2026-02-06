"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        success:
          "border-transparent bg-green-500 text-white hover:bg-green-600",
        warning:
          "border-transparent bg-yellow-500 text-white hover:bg-yellow-600",
        error:
          "border-transparent bg-red-500 text-white hover:bg-red-600",
        info:
          "border-transparent bg-blue-500 text-white hover:bg-blue-600",
        beta:
          "border-transparent bg-gradient-to-r from-purple-600 to-pink-600 text-white",
        outline: "text-foreground border-border bg-transparent",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        dot:
          "border-transparent bg-transparent text-foreground pl-2",
      },
      size: {
        sm: "text-xs",
        md: "text-sm",
        lg: "text-base px-3 py-1",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  children: React.ReactNode;
  removable?: boolean;
  onRemove?: () => void;
  icon?: React.ReactNode;
  dot?: boolean;
  animated?: boolean;
}

function Badge({
  className,
  variant,
  size,
  children,
  removable = false,
  onRemove,
  icon,
  dot = false,
  animated = true,
  onDrag,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onAnimationStart,
  onAnimationEnd,
  onAnimationIteration,
  onTransitionEnd,
  ...props
}: BadgeProps) {
  const [isRemoving, setIsRemoving] = React.useState(false);

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRemoving(true);
    setTimeout(() => {
      onRemove?.();
    }, 200);
  };

  const dotColor = React.useMemo(() => {
    switch (variant) {
      case "success":
        return "bg-green-500";
      case "warning":
        return "bg-yellow-500";
      case "error":
        return "bg-red-500";
      case "info":
        return "bg-blue-500";
      case "beta":
        return "bg-purple-600";
      default:
        return "bg-primary";
    }
  }, [variant]);

  const badgeContent = (
    <>
      {dot && (
        <span
          className={cn(
            "mr-1.5 h-2 w-2 rounded-full",
            dotColor
          )}
        />
      )}
      {icon && <span className="mr-1.5 flex items-center">{icon}</span>}
      {children}
      {removable && (
        <button
          type="button"
          onClick={handleRemove}
          className="ml-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 p-0.5 transition-colors"
          aria-label="Remove"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </>
  );

  if (animated) {
    return (
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={
          isRemoving
            ? { scale: 0.8, opacity: 0 }
            : { scale: 1, opacity: 1 }
        }
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 25,
        }}
        className={cn(badgeVariants({ variant, size }), className)}
        {...props}
      >
        {badgeContent}
      </motion.div>
    );
  }

  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {badgeContent}
    </div>
  );
}

export { Badge, badgeVariants };
