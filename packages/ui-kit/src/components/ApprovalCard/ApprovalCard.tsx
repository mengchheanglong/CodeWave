import { Badge } from '../Badge/Badge';
import styles from './ApprovalCard.module.css';

export type ApprovalStatus = 'requested' | 'approved' | 'denied';

type ApprovalCardProps = {
  toolName: string;
  input?: unknown;
  reason?: string;
  status: ApprovalStatus;
  onApprove?: () => void;
  onDeny?: () => void;
  hint?: string;
};

function formatInput(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(input ?? {}, null, 2);
  } catch {
    text = String(input ?? '');
  }
  const maxLength = 260;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

export function ApprovalCard({
  toolName,
  input,
  reason,
  status,
  onApprove,
  onDeny,
  hint,
}: ApprovalCardProps) {
  const pending = status === 'requested';
  return (
    <article
      className={`${styles.card}${pending ? ` ${styles.pending}` : ''}`}
    >
      <header className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1.5a1.5 1.5 0 0 1 1.5 1.5v1h-3V3A1.5 1.5 0 0 1 8 1.5Z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M3.5 4.5h9v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-9Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className={styles.title}>
          {toolName} · approval required
        </span>
        <Badge tone={pending ? 'warning' : status === 'approved' ? 'success' : 'error'} dot>
          {status}
        </Badge>
      </header>

      {input !== undefined && input !== null ? (
        <pre className={styles.input} title={formatInput(input)}>
          {formatInput(input)}
        </pre>
      ) : null}

      {reason ? <p className={styles.reason}>Reason: {reason}</p> : null}

      {pending ? (
        <div className={styles.actions}>
          {onApprove ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.approve}`}
              onClick={onApprove}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8.5 6.5 12 13 4.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Approve
            </button>
          ) : null}
          {onDeny ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.deny}`}
              onClick={onDeny}
            >
              Deny
            </button>
          ) : null}
          {hint ? <span className={styles.hint}>{hint}</span> : null}
        </div>
      ) : null}
    </article>
  );
}
