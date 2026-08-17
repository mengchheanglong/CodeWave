import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusContainment(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;

    const focusInitialControl = window.setTimeout(() => {
      const container = containerRef.current;
      const initial = initialFocusRef?.current;
      const fallback = container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (initial ?? fallback ?? container)?.focus();
    }, 0);

    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => {
          if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
          if (typeof element.checkVisibility === 'function') {
            return element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
          }
          if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
          }
          return true;
        },
      );
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !container.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !container.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', containFocus);
    return () => {
      window.clearTimeout(focusInitialControl);
      window.removeEventListener('keydown', containFocus);
    };
  }, [active, containerRef, initialFocusRef]);
}
