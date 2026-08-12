import { useState, useEffect, useRef } from 'react';
import { FolderIcon, XIcon } from './icons';

type PromptModalProps = {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
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
  onConfirm,
  onClose,
}: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onConfirm(trimmed);
      onClose();
    }
  };

  return (
    <div className="prompt-modal-backdrop" onClick={onClose}>
      <div
        className="prompt-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
      >
        <div className="prompt-modal-header">
          <div className="prompt-modal-title-group">
            <span className="prompt-modal-icon" aria-hidden="true">
              <FolderIcon size={16} />
            </span>
            <div>
              <h3 id="prompt-modal-title" className="prompt-modal-title">
                {title}
              </h3>
              {subtitle ? <p className="prompt-modal-subtitle">{subtitle}</p> : null}
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
          <div className="prompt-modal-field">
            <input
              ref={inputRef}
              type="text"
              className="prompt-modal-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
              }}
            />
          </div>

          <div className="prompt-modal-footer">
            <button
              type="button"
              className="prompt-modal-btn prompt-modal-btn-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="prompt-modal-btn prompt-modal-btn-confirm"
              disabled={!value.trim()}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
