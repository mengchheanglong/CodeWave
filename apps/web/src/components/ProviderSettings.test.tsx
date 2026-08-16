import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderHealth, ProviderRegistrySnapshot } from '@codewave/protocol';
import { ProviderSettings } from './ProviderSettings';

const registry: ProviderRegistrySnapshot = {
  version: 2,
  revision: 'sha256:test-policy',
  defaultProviderId: 'freebuff',
  configPath: 'C:\\workspace\\.codewave\\providers.json',
  providers: [
    {
      providerId: 'freebuff',
      displayName: 'Freebuff',
      profileKind: 'builtin',
      adapterKind: 'native',
      enabled: true,
      priority: 10,
      accessMode: 'free-cloud',
      dataBoundary: 'cloud-ad-supported',
      requiresExplicitEnable: false,
      command: null,
      args: [],
      setupHint: 'Configure Freebuff.',
      documentationUrl: 'https://example.com/freebuff',
      configurationSource: 'file',
    },
  ],
};

const health: ProviderHealth[] = [
  {
    providerId: 'freebuff',
    available: true,
    detail: 'Ready.',
    capabilities: {
      daemonApprovalMediation: false,
      resumableSessions: false,
      checkpointEvents: false,
      inFlightSteering: 'runtime-negotiated',
    },
  },
];

describe('ProviderSettings modal lifecycle', () => {
  it('does not reset focus when its callback identity changes and Escape uses the latest callback', async () => {
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const { rerender } = render(
      <ProviderSettings open registry={registry} health={health} onClose={firstClose} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());

    const commandInput = screen.getByRole('textbox', { name: 'Command override' });
    commandInput.focus();
    rerender(
      <ProviderSettings open registry={registry} health={health} onClose={latestClose} />,
    );

    expect(commandInput).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(firstClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledTimes(1);
  });

  it('renders a registry-driven custom ACP form with explicit local-code consent', () => {
    render(
      <ProviderSettings open registry={registry} health={health} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add agent' }));
    expect(screen.getByRole('textbox', { name: 'Profile ID' })).toHaveValue('acp.');
    expect(
      screen.getByRole('checkbox', {
        name: /trust this command to run locally/i,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Add disabled profile' }),
    ).toBeDisabled();
  });
});
