import { useState, isValidElement, type ReactNode } from 'react';
import { Spinner } from '../Spinner/Spinner';
import styles from './ToolCard.module.css';

export type ToolStatus =
  | 'running'
  | 'success'
  | 'error'
  | 'pending'
  | 'denied'
  | 'unknown';

type ToolCardProps = {
  toolName: string;
  status: ToolStatus;
  summary?: string;
  detail?: string;
  duration?: string;
  input?: unknown;
  output?: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  title?: string;
};

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}


export function ToolCard({
  toolName,
  status,
  summary,
  detail,
  duration,
  input,
  output,
  expanded: expandedProp,
  onToggle,
  actions,
  title,
}: ToolCardProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = expandedProp ?? localExpanded;

  const hasBody =
    Boolean(detail) ||
    (input !== undefined && input !== null) ||
    (output !== undefined && output !== null) ||
    Boolean(actions);

  const toggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setLocalExpanded((v) => !v);
    }
  };

  return (
    <article className={styles.card} title={title}>
      <button type="button" className={styles.header} onClick={toggle} aria-expanded={expanded}>
        <span
          className={`${styles.caret}${expanded ? ` ${styles.open}` : ''}`}
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
              d="M14 7.5a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M8 4.5v3l2 1.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className={styles.name}>{toolName}</span>
        {summary ? <span className={styles.summary}>{summary}</span> : null}
        <span className={`${styles.status} ${styles[status]}`}>
          {status === 'running' ? (
            <Spinner size={12} />
          ) : (
            <span className={styles.statusDot} aria-hidden="true" />
          )}
          {status}
          {duration ? ` · ${duration}` : ''}
        </span>
      </button>

      {expanded && hasBody ? (
        <div className={styles.body}>
          {detail ? <p className={styles.detail}>{detail}</p> : null}
          {input !== undefined && input !== null ? (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>input</span>
              <pre className={styles.pre}>{formatValue(input)}</pre>
            </div>
          ) : null}
          {output !== undefined && output !== null ? (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>output</span>
              {isValidElement(output) ? (
                <div>{output}</div>
              ) : (
                <pre className={styles.pre}>{formatValue(output)}</pre>
              )}
            </div>
          ) : null}
          {actions ? <div>{actions}</div> : null}
        </div>
      ) : null}

    </article>
  );
}
