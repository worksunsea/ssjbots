import { useEffect, useRef } from "react";

const ITEM_H = 34;
const VISIBLE_ROWS = 3;
const SETTLE_MS = 120;

/** Index of the item whose value is closest to `value` (exact match for strings). */
export function nearestIndex(items, value) {
  if (!items.length) return 0;
  const exact = items.findIndex(it => it.value === value);
  if (exact >= 0) return exact;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  let best = 0;
  let bestDiff = Infinity;
  items.forEach((it, i) => {
    const d = Math.abs(Number(it.value) - n);
    if (d < bestDiff) { best = i; bestDiff = d; }
  });
  return best;
}

/**
 * iOS-style roller. Scroll (touch / mouse wheel / arrow keys) or tap a row to pick.
 * `onChange` fires only on user action, never on programmatic re-centering.
 *
 * @param {{ label?: string, items: {value: string|number, label: string}[], value: string|number,
 *           onChange: (value: string|number) => void, itemHeight?: number, fontSize?: number, fade?: string }} props
 */
export default function WheelPicker({ label, items, value, onChange, itemHeight = ITEM_H, fontSize = 15, fade = "#f8faff" }) {
  const scrollRef = useRef(null);
  const timerRef = useRef(null);
  const selIdx = nearestIndex(items, value);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = selIdx * itemHeight;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
  }, [selIdx, itemHeight, items.length]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleScroll = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const idx = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / itemHeight)));
      if (idx !== selIdx) onChange(items[idx].value);
    }, SETTLE_MS);
  };

  const scrollToIndex = (i) => scrollRef.current?.scrollTo({ top: i * itemHeight, behavior: "smooth" });

  const handleKeyDown = (e) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(items.length - 1, selIdx + step));
    if (next !== selIdx) onChange(items[next].value);
  };

  const height = itemHeight * VISIBLE_ROWS;

  return (
    <div style={{ textAlign: "center", minWidth: 0 }}>
      {label && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "#888", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>}
      <style>{".ssj-wheel::-webkit-scrollbar{display:none}"}</style>
      <div style={{ position: "relative", height }}>
        <div style={{ position: "absolute", left: 2, right: 2, top: itemHeight, height: itemHeight, background: "#dde5f2", borderRadius: 8, pointerEvents: "none" }} />
        <div
          ref={scrollRef}
          className="ssj-wheel"
          role="listbox"
          aria-label={label}
          tabIndex={0}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          style={{ position: "relative", height, overflowY: "scroll", scrollSnapType: "y mandatory", overscrollBehavior: "contain", touchAction: "pan-y", scrollbarWidth: "none", outline: "none" }}
        >
          <div style={{ height: itemHeight }} />
          {items.map((it, i) => {
            const isSel = i === selIdx;
            return (
              <div
                key={String(it.value)}
                role="option"
                aria-selected={isSel}
                title={it.label}
                onClick={() => scrollToIndex(i)}
                style={{ height: itemHeight, lineHeight: `${itemHeight}px`, scrollSnapAlign: "center", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: "0 2px", fontSize: isSel ? fontSize + 2 : fontSize - 1, fontWeight: isSel ? 700 : 500, color: isSel ? "#111" : "#9aa3b2", transition: "font-size 0.12s, color 0.12s" }}
              >
                {it.label}
              </div>
            );
          })}
          <div style={{ height: itemHeight }} />
        </div>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `linear-gradient(${fade} 0%, transparent 32%, transparent 68%, ${fade} 100%)` }} />
      </div>
    </div>
  );
}
