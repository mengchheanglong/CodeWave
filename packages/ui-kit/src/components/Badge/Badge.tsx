import type { ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'running'
  | 'accent';

type BadgeProps = {
  tone?: BadgeTone;
  children: ReactNode;
  title?: string;
  dot?: boolean;
  className?: string;
};

export function Badge({
  tone = 'neutral',
  children,
  title,
  dot = false,
  className,
}: BadgeProps) {
  return (
    <span
      className={`${styles.badge} ${styles[tone]}${className ? ` ${className}` : ''}`}
      title={title}
    >
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
