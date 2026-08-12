import styles from './ContextMeter.module.css';

type ContextMeterProps = {
  percent: number;
  label?: string;
  title?: string;
  className?: string;
};

export function ContextMeter({
  percent,
  label,
  title,
  className,
}: ContextMeterProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const tone =
    clamped >= 90 ? 'critical' : clamped >= 70 ? 'warn' : undefined;
  return (
    <span
      className={`${styles.meter}${className ? ` ${className}` : ''}`}
      title={title}
    >
      <span className={styles.track} aria-hidden="true">
        <span
          className={`${styles.fill}${tone ? ` ${styles[tone]}` : ''}`}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className={styles.label}>
        {label ?? `${Math.round(clamped)}%`}
      </span>
    </span>
  );
}
