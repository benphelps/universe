import { useState, type ReactNode } from 'react';

/** The console's width on a wide screen, and how far it may be pulled. */
export const CONSOLE_WIDTH = 390;
const MIN_WIDTH = 320;
const WIDTH_KEY = 'console-width';

/** How wide the console may go: room must stay for the view. */
function maxWidth(): number {
  return Math.max(MIN_WIDTH, Math.min(900, Math.round(window.innerWidth * 0.6)));
}

function clamp(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(maxWidth(), Math.round(width)));
}

/** The remembered width, or the default. */
export function useConsoleWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      return saved > 0 ? clamp(saved) : CONSOLE_WIDTH;
    } catch {
      return CONSOLE_WIDTH;
    }
  });
  const set = (next: number): void => {
    const clamped = clamp(next);
    setWidth(clamped);
    try {
      localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      // Fine: the console returns to its default width next visit.
    }
  };
  return [width, set];
}

/**
 * The grip along the console's outer edge: drag to set its width,
 * double-click to put it back. The view beside it follows through
 * its own resize observer.
 */
export function ConsoleGrip({ onWidth }: { onWidth: (width: number) => void }): ReactNode {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      id="console-grip"
      className={dragging ? 'dragging' : ''}
      role="separator"
      aria-orientation="vertical"
      aria-label="console width"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        document.body.classList.add('console-resizing');
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        onWidth(event.clientX);
      }}
      onPointerUp={(event) => {
        if (!dragging) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
        document.body.classList.remove('console-resizing');
      }}
      onDoubleClick={() => onWidth(CONSOLE_WIDTH)}
    />
  );
}
