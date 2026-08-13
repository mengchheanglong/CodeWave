import type { ReactNode } from 'react';
import { Badge } from '@codewave/ui-kit';

type TabItem<T extends string> = {
  id: T;
  label: string;
  badge?: number | string;
  hot?: boolean;
  icon?: ReactNode;
};

type TabBarProps<T extends string> = {
  activeId: T;
  items: TabItem<T>[];
  onSelect: (id: T) => void;
  className?: string;
};

export function TabBar<T extends string>({
  activeId,
  items,
  onSelect,
  className,
}: TabBarProps<T>) {
  return (
    <div className={`tab-bar${className ? ` ${className}` : ''}`} role="tablist">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`tab-chip${active ? ' active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            {item.icon ? <span className="tab-icon">{item.icon}</span> : null}
            <span className="tab-label">{item.label}</span>
            {item.badge !== undefined ? (
              <Badge tone={item.hot ? 'warning' : active ? 'accent' : 'neutral'}>
                {item.badge}
              </Badge>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
