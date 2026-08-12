import type { ReactNode } from 'react';
import styles from './UserCard.module.css';

type UserCardProps = {
  text: string;
  timestamp?: string;
  avatar?: ReactNode;
  title?: string;
  className?: string;
};

export function UserCard({
  text,
  timestamp,
  avatar,
  title,
  className,
}: UserCardProps) {
  return (
    <article className={`${styles.card}${className ? ` ${className}` : ''}`} title={title}>
      <header className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">
          {avatar ?? (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          )}
        </span>
        <span className={styles.author}>You</span>
        {timestamp ? <span className={styles.timestamp}>{timestamp}</span> : null}
      </header>
      <div className={styles.body}>
        <pre className={styles.text}>{text}</pre>
      </div>
    </article>
  );
}
