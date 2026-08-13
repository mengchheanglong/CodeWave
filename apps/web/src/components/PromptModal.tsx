import { useState, useEffect, useRef } from 'react';
import { FolderIcon, TrashIcon, XIcon } from './icons';

type PromptModalProps = {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  mode?: 'prompt' | 'confirm';
  destructive?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
};

export function PromptModal({
  isOpen,
  title,
  subtitle,
  placeholder = 'Enter path...',
  defaultValue = '',
  confirmLabel = 'Open Folder',
  mode = 'prompt',
  destructive = false,
  onConfirm,
  onClose,
}: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    setValue(defaultValue);
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      const target = mode === 'confirm' ? cancelButtonRef.current : inputRef.current;
      target?.focus();
      if (target instanceof HTMLInputElement) target.select();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const focusIsOutside = !dialogRef.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || focusIsOutside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || focusIsOutside)) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const submittedValue = mode === 'confirm' ? defaultValue : value.trim();
    if (mode === 'confirm' || submittedValue) {
      onConfirm(submittedValue);
      onClose();
    }
  };

  return (
    <div className="prompt-modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="prompt-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
        aria-describedby={subtitle ? 'prompt-modal-description' : undefined}
        tabIndex={-1}
      >
        <div className="prompt-modal-header">
          <div className="prompt-modal-title-group">
            <span className="prompt-modal-icon" aria-hidden="true">
              {destructive ? <TrashIcon size={16} /> : <FolderIcon size={16} />}
            </span>
            <div>
              <h3 id="prompt-modal-title" className="prompt-modal-title">
                {title}
              </h3>
              {subtitle ? (
                <p id="prompt-modal-description" className="prompt-modal-subtitle">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="prompt-modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <XIcon size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="prompt-modal-body">
          {mode === 'prompt' ? (
            <div className="prompt-modal-field">
              <input
                ref={inputRef}
                type="text"
                className="prompt-modal-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
              />
            </div>
          ) : null}

          <div className="prompt-modal-footer">
            <button
              ref={cancelButtonRef}
              type="button"
              className="prompt-modal-btn prompt-modal-btn-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`prompt-modal-btn prompt-modal-btn-confirm${
                destructive ? ' prompt-modal-btn-destructive' : ''
              }`}
              disabled={mode === 'prompt' && !value.trim()}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
