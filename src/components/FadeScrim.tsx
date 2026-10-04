import { motion } from "framer-motion";
import { fadeExit, overlayTransition } from "../lib/uiMotion";

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
      initial={{ opacity: 0, pointerEvents: "none" }}
      animate={{ opacity: 1, pointerEvents: "auto" }}
      exit={fadeExit()}
      transition={{ ...overlayTransition, pointerEvents: { duration: 0 } }}
      onClick={onClick}
      aria-label={label}
    />
  );
}
