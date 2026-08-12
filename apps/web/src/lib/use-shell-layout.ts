import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';

const LEFT_WIDTH_KEY = 'codewave:left-column-width:v2';
const RIGHT_WIDTH_KEY = 'codewave:right-column-width:v2';
const DEFAULT_LEFT_WIDTH = 292;
const DEFAULT_RIGHT_WIDTH = 348;
const MIN_LEFT_WIDTH = 232;
const MAX_LEFT_WIDTH = 440;
const MIN_RIGHT_WIDTH = 286;
const MAX_RIGHT_WIDTH = 480;

function readStoredWidth(
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return Math.min(max, Math.max(min, parsed));
    }
  } catch {}

  return fallback;
}

function clampWidth(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useShellLayout() {
  const [leftColumnWidth, setLeftColumnWidth] = useState(() =>
    readStoredWidth(
      LEFT_WIDTH_KEY,
      DEFAULT_LEFT_WIDTH,
      MIN_LEFT_WIDTH,
      MAX_LEFT_WIDTH,
    ),
  );
  const [rightColumnWidth, setRightColumnWidth] = useState(() =>
    readStoredWidth(
      RIGHT_WIDTH_KEY,
      DEFAULT_RIGHT_WIDTH,
      MIN_RIGHT_WIDTH,
      MAX_RIGHT_WIDTH,
    ),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(LEFT_WIDTH_KEY, String(leftColumnWidth));
    } catch {}
  }, [leftColumnWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RIGHT_WIDTH_KEY, String(rightColumnWidth));
    } catch {}
  }, [rightColumnWidth]);

  const startLeftResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = leftColumnWidth;

      function handleMove(moveEvent: MouseEvent) {
        const delta = moveEvent.clientX - startX;
        setLeftColumnWidth(
          clampWidth(startWidth + delta, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH),
        );
      }

      function handleUp() {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      }

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [leftColumnWidth],
  );

  const startRightResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = rightColumnWidth;

      function handleMove(moveEvent: MouseEvent) {
        const delta = moveEvent.clientX - startX;
        setRightColumnWidth(
          clampWidth(startWidth - delta, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH),
        );
      }

      function handleUp() {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      }

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [rightColumnWidth],
  );

  return {
    leftColumnWidth,
    rightColumnWidth,
    startLeftResize,
    startRightResize,
  };
}
