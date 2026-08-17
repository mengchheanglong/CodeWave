import { useCallback, useRef, useEffect } from 'react';

const MIN_ROWS = 1;
const MAX_ROWS = 12;

/**
 * Auto-resize a textarea based on its content.
 * Returns a ref to attach to the textarea element.
 */
export function useAutoResizeTextarea() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    // Reset height to recalculate
    el.style.height = 'auto';

    // Clamp between min and max rows
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 21;
    const minHeight = lineHeight * MIN_ROWS;
    const maxHeight = lineHeight * MAX_ROWS;

    const scrollHeight = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(scrollHeight, minHeight), maxHeight)}px`;
    el.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    autoResize();
    window.addEventListener('resize', autoResize);
    return () => window.removeEventListener('resize', autoResize);
  }, [autoResize]);

  return { textareaRef, autoResize };
}
