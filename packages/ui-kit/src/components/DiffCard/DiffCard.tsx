import { useMemo, useState } from 'react';
import styles from './DiffCard.module.css';

export type DiffLine = {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
};

export type DiffHunk = {
  lines: DiffLine[];
};

export function parseUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  const push = (line: DiffLine) => {
    if (!current) {
      current = { lines: [] };
      hunks.push(current);
    }
    current.lines.push(line);
  };

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('@@')) {
      current = { lines: [] };
      current.lines.push({ kind: 'hunk', text: raw });
      hunks.push(current);
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('+++ ')) {
      push({ kind: 'ctx', text: raw });
      continue;
    }
    const kind: DiffLine['kind'] = raw.startsWith('+')
      ? 'add'
      : raw.startsWith('-')
        ? 'del'
        : 'ctx';
    push({ kind, text: raw });
  }
  return hunks;
}

type DiffCardProps = {
  diff: string;
  fileName?: string;
  initialLines?: number;
};

export function DiffCard({
  diff,
  fileName,
  initialLines = 12,
}: DiffCardProps) {
  const hunks = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const [limit, setLimit] = useState(initialLines);

  const flatLines = useMemo(
    () => hunks.flatMap((hunk) => hunk.lines),
    [hunks],
  );
  const addCount = flatLines.filter((l) => l.kind === 'add').length;
  const delCount = flatLines.filter((l) => l.kind === 'del').length;
  const truncated = flatLines.length > limit;

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <span className={styles.fileIcon} aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 1.5h6l4 4v9H3z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M9 1.5v4h4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className={styles.file}>{fileName ?? 'diff'}</span>
        <span className={styles.stats}>
          <span className={styles.add}>+{addCount}</span>
          <span className={styles.del}>-{delCount}</span>
        </span>
      </header>
      <div className={styles.viewport}>
        {flatLines.slice(0, limit).map((line, index) => (
          <div
            className={`${styles.line} ${styles[`${line.kind}Line`]}`}
            key={index}
          >
            <span className={styles.sign} aria-hidden="true">
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ''}
            </span>
            <span className={styles.content}>{line.text}</span>
          </div>
        ))}
      </div>
      {truncated ? (
        <button
          type="button"
          className={styles.more}
          onClick={() => setLimit((v) => v + 100)}
        >
          Show {flatLines.length - limit} more lines
        </button>
      ) : null}
    </article>
  );
}
