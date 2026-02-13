/**
 * Apple-inspired spring animation presets for Framer Motion
 * Based on WWDC 2023 spring animation guidelines
 */

export const springs = {
  /**
   * Micro interactions - Very quick, subtle animations
   * Use for: Small UI feedback (button taps, toggles)
   */
  micro: {
    type: "spring" as const,
    stiffness: 500,
    damping: 30,
    mass: 0.5,
  },

  /**
   * Default - Balanced, natural feel
   * Use for: Most UI animations (cards, modals, panels)
   */
  default: {
    type: "spring" as const,
    stiffness: 300,
    damping: 25,
  },

  /**
   * Gentle - Smooth, relaxed movement
   * Use for: Large content areas, page transitions
   */
  gentle: {
    type: "spring" as const,
    stiffness: 200,
    damping: 20,
  },

  /**
   * Bouncy - Playful spring with overshoot
   * Use for: Celebratory animations, emphasis
   */
  bouncy: {
    type: "spring" as const,
    stiffness: 400,
    damping: 15,
  },

  /**
   * Snappy - Fast, responsive, crisp
   * Use for: Navigation, quick state changes
   */
  snappy: {
    type: "spring" as const,
    stiffness: 600,
    damping: 35,
  },
} as const;

/**
 * Stagger animation helper
 * Creates a delay based on index for staggered list animations
 */
export function staggerDelay(index: number, baseDelay = 0.05): number {
  return index * baseDelay;
}

/**
 * Fade in animation variants
 */
export const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

/**
 * Scale animation variants (for modals, popovers)
 */
export const scaleIn = {
  initial: { scale: 0.95, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.95, opacity: 0 },
};

/**
 * Slide animation variants
 */
export const slideIn = {
  fromRight: {
    initial: { x: '100%', opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: '100%', opacity: 0 },
  },
  fromLeft: {
    initial: { x: '-100%', opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: '-100%', opacity: 0 },
  },
  fromTop: {
    initial: { y: '-100%', opacity: 0 },
    animate: { y: 0, opacity: 1 },
    exit: { y: '-100%', opacity: 0 },
  },
  fromBottom: {
    initial: { y: '100%', opacity: 0 },
    animate: { y: 0, opacity: 1 },
    exit: { y: '100%', opacity: 0 },
  },
};
