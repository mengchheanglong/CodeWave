import { useState } from 'react';
import styles from './ThinkingBlock.module.css';

type ThinkingBlockProps = {
  text: string;
  duration?: string;
  streaming?: boolean;
  defaultOpen?: boolean;
  title?: string;
};

export function ThinkingBlock({
  text,
  duration,
  streaming = false,
  defaultOpen = false,
  title,
}: ThinkingBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const label = streaming ? 'Thinking…' : 'Thinking';

  return (
    <article className={styles.block} title={title}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span
          className={`${styles.caret}${open ? ` ${styles.open}` : ''}`}
          aria-hidden="true"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className={styles.icon} aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1.5a3 3 0 0 1 3 3c0 .9-.4 1.7-1 2.3V9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6.8a3 3 0 0 1-1-2.3 3 3 0 0 1 3-3Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M6.5 13.5h3M7.5 15h1"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className={styles.label}>{label}</span>
        {duration ? <span className={styles.duration}>{duration}</span> : null}
      </button>
      {open ? (
        <div className={styles.body}>
          <pre className={styles.text}>{text}</pre>
        </div>
      ) : null}
    </article>
  );
}
