import { MarkdownRenderer } from '../MarkdownRenderer/MarkdownRenderer';
import styles from './AssistantCard.module.css';

type AssistantCardProps = {
  text: string;
  providerLabel?: string;
  timestamp?: string;
  streaming?: boolean;
  title?: string;
  className?: string;
};

export function AssistantCard({
  text,
  providerLabel = 'Assistant',
  timestamp,
  streaming = false,
  title,
  className,
}: AssistantCardProps) {
  return (
    <article className={`${styles.card}${className ? ` ${className}` : ''}`} title={title}>
      <header className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1.5 13.5 5v6L8 14.5 2.5 11V5L8 1.5Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
          </svg>
        </span>
        <span className={styles.author}>{providerLabel}</span>
        {streaming ? (
          <span className={styles.streamingIndicator} aria-label="Streaming response">
            <span className={styles.pulseDot} />
          </span>
        ) : null}
        {timestamp ? <span className={styles.timestamp}>{timestamp}</span> : null}
      </header>
      <div className={styles.body}>
        <MarkdownRenderer content={text} />
      </div>
    </article>
  );
}
