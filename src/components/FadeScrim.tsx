import { motion } from "framer-motion";
import { overlayTransition } from "../lib/uiMotion";

export function FadeScrim({
  className = "scrim",
  onClick,
  label,
}: {
  className?: string;
  onClick: () => void;
  label: string;
}) {
  return (
    <motion.button
      type="button"
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={overlayTransition}
      onClick={onClick}
      aria-label={label}
    />
  );
}
