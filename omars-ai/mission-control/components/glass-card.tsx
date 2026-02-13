'use client';

import { motion, type HTMLMotionProps } from 'framer-motion';
import { springs } from '@/lib/springs';

interface GlassCardProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'elevated' | 'subtle';
  animate?: boolean;
}

export function GlassCard({
  children,
  className = '',
  variant = 'default',
  animate = true,
  ...props
}: GlassCardProps) {
  const baseClasses = 'rounded-2xl border backdrop-blur-xl';

  const variantClasses = {
    default: 'border-white/20 bg-white/60 shadow-sm dark:bg-white/5 dark:border-white/10',
    elevated: 'border-white/30 bg-white/70 shadow-lg dark:bg-white/8 dark:border-white/15',
    subtle: 'border-white/10 bg-white/40 shadow-none dark:bg-white/3 dark:border-white/5',
  };

  const combinedClasses = `${baseClasses} ${variantClasses[variant]} ${className}`;

  if (!animate) {
    return (
      <div className={combinedClasses} {...(props as any)}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.default}
      className={combinedClasses}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function GlassButton({
  children,
  className = '',
  variant = 'default',
  ...props
}: HTMLMotionProps<"button"> & { variant?: 'default' | 'primary' | 'ghost' }) {
  const baseClasses = 'rounded-xl px-4 py-2 font-medium transition-all';

  const variantClasses = {
    default: 'bg-white/10 hover:bg-white/20 border border-white/20 dark:bg-white/5 dark:hover:bg-white/10',
    primary: 'bg-brand text-white hover:bg-brand-light shadow-md hover:shadow-lg',
    ghost: 'hover:bg-white/10 dark:hover:bg-white/5',
  };

  const combinedClasses = `${baseClasses} ${variantClasses[variant]} ${className}`;

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      whileHover={{ scale: 1.02 }}
      transition={springs.snappy}
      className={combinedClasses}
      {...props}
    >
      {children}
    </motion.button>
  );
}

export function GlassModal({
  children,
  isOpen,
  onClose,
  className = '',
}: {
  children: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
      />

      {/* Modal */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={springs.default}
        className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 ${className}`}
      >
        <GlassCard variant="elevated" animate={false} className="p-8">
          {children}
        </GlassCard>
      </motion.div>
    </>
  );
}
