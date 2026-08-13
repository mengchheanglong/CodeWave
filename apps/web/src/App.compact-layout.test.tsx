import '@testing-library/jest-dom';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

type MediaController = {
  setMatches: (query: string, matches: boolean) => void;
};

function installMatchMedia(): MediaController {
  const entries = new Map<
    string,
    {
      mediaQuery: MediaQueryList;
      listeners: Set<(event: MediaQueryListEvent) => void>;
    }
  >();

  vi.stubGlobal('matchMedia', (query: string) => {
    const existing = entries.get(query);
    if (existing) return existing.mediaQuery;

    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mediaQuery = {
      matches: query === '(max-width: 700px)' || query === '(max-width: 1180px)',
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      dispatchEvent: () => true,
    } as MediaQueryList;
    entries.set(query, { mediaQuery, listeners });
    return mediaQuery;
  });

  return {
    setMatches(query, matches) {
      const entry = entries.get(query);
      if (!entry) throw new Error(`No matchMedia listener for ${query}`);
      Object.defineProperty(entry.mediaQuery, 'matches', {
        configurable: true,
        value: matches,
      });
      const event = { matches, media: query } as MediaQueryListEvent;
      for (const listener of entry.listeners) listener(event);
    },
  };
}

describe('App compact navigation', () => {
  let media: MediaController;

  beforeEach(() => {
    media = installMatchMedia();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens and dismisses the navigation drawer through its scrim', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const toggle = screen.getByRole('button', { name: 'Open navigation' });

    expect(toggle).toHaveAttribute('aria-controls', 'workspace-navigation');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.compact-navigation-open')).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: /Filter rail items/i })).toHaveFocus();
    });
    const content = container.querySelector('.content-shell');
    expect(content).toHaveAttribute('inert');
    expect(content).toHaveAttribute('aria-hidden', 'true');

    const scrim = container.querySelector<HTMLButtonElement>('.compact-navigation-scrim');
    expect(scrim).not.toBeNull();
    await user.click(scrim!);

    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveFocus();
    });
    expect(container.querySelector('.compact-navigation-scrim')).toBeNull();
    expect(content).not.toHaveAttribute('inert');
  });

  it('closes on Escape and restores focus to the navigation toggle', async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByRole('button', { name: 'Open navigation' });

    await user.click(toggle);
    const filter = screen.getByRole('searchbox', { name: /Filter rail items/i });
    await user.click(filter);
    expect(filter).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveFocus();
    });
  });

  it('closes the compact inspector on Escape and restores focus to its toggle', async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByRole('button', { name: 'Open right rail' });

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide right rail' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() => {
      const restoredToggle = screen.getByRole('button', { name: 'Open right rail' });
      expect(restoredToggle).toHaveFocus();
    });
  });

  it('contains Tab navigation inside the open drawer', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const navigation = document.getElementById('workspace-navigation')!;
    const focusable = [...navigation.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];

    focusable.at(-1)!.focus();
    await user.tab();
    expect(focusable[0]).toHaveFocus();

    focusable[0]!.focus();
    await user.tab({ shift: true });
    expect(focusable.at(-1)).toHaveFocus();
  });

  it('closes for modal navigation and clears stale state at desktop width', async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByRole('button', { name: 'Open navigation' });

    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Providers' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog', { name: 'Providers' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    media.setMatches('(max-width: 700px)', false);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
    media.setMatches('(max-width: 700px)', true);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
