export type AppTheme = 'dark';

export function readInitialTheme(): AppTheme {
  return 'dark';
}

export function applyTheme(_theme: AppTheme = 'dark'): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.theme = 'dark';
}
