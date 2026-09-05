export const overlayTransition = { duration: 0.2 } as const;

export const panelSpring = { type: "spring" as const, stiffness: 380, damping: 32 };

export const popSpring = { type: "spring" as const, stiffness: 420, damping: 34 };

/** pointer-events cade instant, ca overlay-ul să nu mănânce click-urile pe hartă în timpul fade-ului. */
const instantPointerNone = { pointerEvents: { duration: 0 } } as const;

export function fadeExit<T extends Record<string, unknown>>(extra?: T, duration: number = overlayTransition.duration) {
  return {
    opacity: 0,
    ...extra,
    pointerEvents: "none" as const,
    transition: { duration, pointerEvents: instantPointerNone.pointerEvents },
  };
}

export function springExit<T extends Record<string, unknown>>(extra?: T) {
  return {
    ...extra,
    pointerEvents: "none" as const,
    transition: { ...panelSpring, ...instantPointerNone },
  };
}

export function popExit<T extends Record<string, unknown>>(extra?: T) {
  return {
    opacity: 0,
    scale: 0.96,
    y: -6,
    ...extra,
    pointerEvents: "none" as const,
    transition: { ...panelSpring, ...instantPointerNone },
  };
}

