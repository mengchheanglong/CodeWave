import styles from './Spinner.module.css';

type SpinnerProps = {
  size?: number;
  label?: string;
};

export function Spinner({ size, label = 'Working…' }: SpinnerProps) {
  return (
    <span
      className={styles.spinner}
      style={size ? { width: size, height: size } : undefined}
      role="status"
      aria-label={label}
    />
  );
}
