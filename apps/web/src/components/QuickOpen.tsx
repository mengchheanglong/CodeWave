import { useEffect, useMemo, useState } from 'react';

export type QuickOpenItem = {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  badge?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
};

type QuickOpenProps = {
  items: QuickOpenItem[];
  open: boolean;
  onClose: () => void;
};

function matches(item: QuickOpenItem, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  const haystack = [
    item.group,
    item.title,
    item.subtitle ?? '',
    item.badge ?? '',
    ...(item.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function QuickOpen({
  items,
  open,
  onClose,
}: QuickOpenProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredItems = useMemo(
    () => items.filter((item) => matches(item, query)),
    [items, query],
  );

  const groupedItems = useMemo(() => {
    const nextGroups = new Map<string, QuickOpenItem[]>();

    for (const item of filteredItems) {
      const groupItems = nextGroups.get(item.group);
      if (groupItems) {
        groupItems.push(item);
        continue;
      }
      nextGroups.set(item.group, [item]);
    }

    let startIndex = 0;
    return Array.from(nextGroups.entries()).map(([label, groupItems]) => {
      const group = {
        label,
        items: groupItems,
        startIndex,
      };
      startIndex += groupItems.length;
      return group;
    });
  }, [filteredItems]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) {
    return null;
  }

  async function executeSelected() {
    const item = filteredItems[activeIndex];
    if (!item) {
      return;
    }

    try {
      await item.run();
    } finally {
      onClose();
    }
  }

  async function executeItem(item: QuickOpenItem) {
    try {
      await item.run();
    } finally {
      onClose();
    }
  }

  return (
    <div className="quick-open-backdrop" onClick={onClose}>
      <div
        className="quick-open"
        role="dialog"
        aria-modal="true"
        aria-label="Quick Open"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="quick-open-header">
          <div>
            <p className="eyebrow">Quick Open</p>
            <h2>Jump across the workbench</h2>
          </div>
          <span className="quick-open-tip">Esc to close</span>
        </div>

        <input
          autoFocus
          className="quick-open-input"
          type="text"
          placeholder="Search actions, sessions, runs, and views..."
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
              return;
            }

            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((current) =>
                Math.min(current + 1, Math.max(filteredItems.length - 1, 0)),
              );
              return;
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
              return;
            }

            if (event.key === 'Enter') {
              event.preventDefault();
              void executeSelected();
            }
          }}
        />

        <div className="quick-open-list">
          {filteredItems.length === 0 ? (
            <div className="empty">No matching actions.</div>
          ) : (
            groupedItems.map((group) => {
              return (
                <section key={group.label} className="quick-open-group">
                  <div className="quick-open-group-title">
                    <span>{group.label}</span>
                    <strong>{group.items.length}</strong>
                  </div>

                  {group.items.map((item, itemOffset) => {
                    const itemIndex = group.startIndex + itemOffset;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`quick-open-item${itemIndex === activeIndex ? ' active' : ''}`}
                        onMouseEnter={() => {
                          setActiveIndex(itemIndex);
                        }}
                        onClick={() => {
                          void executeItem(item);
                        }}
                      >
                        <div>
                          <strong>{item.title}</strong>
                          {item.subtitle ? <span>{item.subtitle}</span> : null}
                        </div>
                        {item.badge ? (
                          <span className="quick-open-badge">{item.badge}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
