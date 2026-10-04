import {
  cloneElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

const HOVER_MS = 0;
const HOLD_MS = 450;

type TipChildProps = {
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (e: PointerEvent<HTMLElement>) => void;
  onClickCapture?: (e: MouseEvent<HTMLElement>) => void;
};

type TipProps = {
  text: string;
  children: ReactElement<TipChildProps>;
};

export function Tip({ text, children }: TipProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<{ top: number; left: number; transform: string }>({ top: 0, left: 0, transform: "translate(-50%, 0)" });
  const hoverTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const placeBubble = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    const estH = 40;
    const below = rect.bottom + gap + estH <= window.innerHeight - 8;
    const top = below ? rect.bottom + gap : rect.top - gap;
    const transform = below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
    const center = rect.left + rect.width / 2;
    const half = 110;
    const left = Math.min(window.innerWidth - 8 - half, Math.max(8 + half, center));
    setStyle({ top, left, transform });
  }, []);

  const show = useCallback(() => {
    placeBubble();
    setVisible(true);
  }, [placeBubble]);

  const hide = useCallback(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    hoverTimer.current = null;
    holdTimer.current = null;
    suppressClick.current = false;
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onScroll = () => placeBubble();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [visible, placeBubble]);

  const onMouseEnter = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (HOVER_MS <= 0) {
      show();
      return;
    }
    hoverTimer.current = window.setTimeout(show, HOVER_MS);
  };

  const onMouseLeave = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hide();
  };

  const mergeFocus = (e: FocusEvent<HTMLElement>) => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    show();
    children.props.onFocus?.(e);
  };

  const mergeBlur = (e: FocusEvent<HTMLElement>) => {
    hide();
    children.props.onBlur?.(e);
  };

  const mergePointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "touch") {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      suppressClick.current = false;
      holdTimer.current = window.setTimeout(() => {
        suppressClick.current = true;
        show();
      }, HOLD_MS);
    }
    children.props.onPointerDown?.(e);
  };

  const mergePointerUp = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "touch") {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
      if (suppressClick.current) {
        hide();
      }
    }
    children.props.onPointerUp?.(e);
  };

  const mergePointerCancel = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "touch") {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
      suppressClick.current = false;
      hide();
    }
    children.props.onPointerCancel?.(e);
  };

  const mergeClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick.current = false;
      hide();
    }
    children.props.onClickCapture?.(e);
  };

  const child = cloneElement(children, {
    onFocus: mergeFocus,
    onBlur: mergeBlur,
    onPointerDown: mergePointerDown,
    onPointerUp: mergePointerUp,
    onPointerCancel: mergePointerCancel,
    onClickCapture: mergeClickCapture,
  });

  return (
    <>
      <span ref={wrapRef} className="tip" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {child}
      </span>
      {visible &&
        createPortal(
          <div role="tooltip" className="tip-bubble" style={{ position: "fixed", zIndex: 80, top: style.top, left: style.left, transform: style.transform }}>
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
