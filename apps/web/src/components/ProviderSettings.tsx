import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProviderConfiguration,
  ProviderHealth,
  ProviderId,
  ProviderRegistrySnapshot,
  UpdateProviderConfigurationRequest,
} from '@codewave/protocol';
import { requestRuntimeRefresh } from '../app-controller';
import { createDaemonApi } from '../lib/daemon-api';
import { renderProviderLabel } from '../lib/shell-format';

type ProviderSettingsProps = {
  open: boolean;
  registry: ProviderRegistrySnapshot | null;
  health: ProviderHealth[];
  onClose: () => void;
};

function accessLabel(configuration: ProviderConfiguration): string {
  if (configuration.accessMode === 'free-cloud') return 'Free cloud';
  if (configuration.accessMode === 'local-or-byok') return 'Local / BYOK';
  return 'Paid / BYOK';
}

function boundaryLabel(configuration: ProviderConfiguration): string {
  if (configuration.dataBoundary === 'cloud-ad-supported') {
    return 'Cloud · ad-supported';
  }
  if (configuration.dataBoundary === 'local-or-user-configured') {
    return 'Local or your endpoint';
  }
  return 'Provider-managed';
}

function statusLabel(providerHealth: ProviderHealth | undefined): string {
  if (!providerHealth) return 'Unknown';
  if (providerHealth.status === 'disabled') return 'Off';
  if (providerHealth.available) return 'Ready';
  if (providerHealth.status === 'setup-required') return 'Setup';
  return 'Unavailable';
}

export function ProviderSettings({
  open,
  registry,
  health,
  onClose,
}: ProviderSettingsProps) {
  const apiRef = useRef(
    createDaemonApi({
      onProviderRevisionConflict: async () => {
        await requestRuntimeRefresh();
      },
    }),
  );
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const [busyProviderId, setBusyProviderId] = useState<ProviderId | null>(null);
  const [defaultBusy, setDefaultBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [commandDrafts, setCommandDrafts] = useState<
    Partial<Record<ProviderId, string>>
  >({});

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!registry) return;
    setCommandDrafts(
      Object.fromEntries(
        registry.providers.map((provider) => [provider.providerId, provider.command ?? '']),
      ) as Partial<Record<ProviderId, string>>,
    );
  }, [registry]);

  useEffect(() => {
    if (!open) return;
    setActionMessage(null);
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
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
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
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
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [open]);

  const healthByProvider = useMemo(
    () => new Map(health.map((entry) => [entry.providerId, entry] as const)),
    [health],
  );

  if (!open) return null;

  async function updateProvider(
    providerId: ProviderId,
    patch: Omit<UpdateProviderConfigurationRequest, 'expectedProviderRevision'>,
  ) {
    if (!registry) return;
    setBusyProviderId(providerId);
    setActionMessage(null);
    try {
      await apiRef.current.updateProvider(providerId, {
        ...patch,
        expectedProviderRevision: registry.revision,
      });
      await requestRuntimeRefresh();
      setActionMessage({
        kind: 'success',
        text: `${renderProviderLabel(providerId)} settings saved.`,
      });
    } catch (error) {
      setActionMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Provider settings could not be saved.',
      });
    } finally {
      setBusyProviderId(null);
    }
  }

  async function updateDefault(providerId: ProviderId) {
    if (!registry) return;
    setDefaultBusy(true);
    setActionMessage(null);
    try {
      await apiRef.current.updateDefaultProvider({
        providerId,
        expectedProviderRevision: registry.revision,
      });
      await requestRuntimeRefresh();
      setActionMessage({
        kind: 'success',
        text: `${renderProviderLabel(providerId)} is now the default provider.`,
      });
    } catch (error) {
      setActionMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'The default provider could not be changed.',
      });
    } finally {
      setDefaultBusy(false);
    }
  }

  return (
    <div className="provider-settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="provider-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="provider-settings-header">
          <div>
            <span className="provider-settings-kicker">Runtime registry</span>
            <h2 id="provider-settings-title">Providers</h2>
            <p>
              Free-first by policy. Paid runtimes stay off until you explicitly enable them.
            </p>
            {registry ? (
              <span className="provider-settings-revision" title={registry.revision}>
                Policy {registry.revision.slice(0, 15)}
              </span>
            ) : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="provider-settings-close"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div
          className={`provider-settings-feedback ${actionMessage?.kind ?? ''}`}
          role={actionMessage?.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {actionMessage?.text ?? 'Changes are applied to new sessions after the runtime refreshes.'}
        </div>

        <div className="provider-settings-list">
          {registry?.providers.map((provider) => {
            const providerHealth = healthByProvider.get(provider.providerId);
            const environmentLocked = provider.configurationSource === 'environment';
            const busy = busyProviderId === provider.providerId;
            const commandDraft = commandDrafts[provider.providerId] ?? '';
            const commandChanged = commandDraft.trim() !== (provider.command ?? '');
            return (
              <article
                key={provider.providerId}
                className={`provider-settings-card provider-status-${
                  providerHealth?.status ?? 'unavailable'
                }`}
              >
                <div className="provider-settings-card-top">
                  <div className="provider-settings-identity">
                    <span className="provider-settings-wave" aria-hidden="true"></span>
                    <div>
                      <div className="provider-settings-name-row">
                        <h3>{renderProviderLabel(provider.providerId)}</h3>
                        {provider.providerId === 'freebuff' ? (
                          <span className="provider-primary-badge">Primary</span>
                        ) : null}
                        {registry.defaultProviderId === provider.providerId ? (
                          <span className="provider-default-badge">Default</span>
                        ) : null}
                      </div>
                      <div className="provider-settings-meta">
                        <span>{accessLabel(provider)}</span>
                        <span>{boundaryLabel(provider)}</span>
                        <span>Priority {provider.priority}</span>
                      </div>
                    </div>
                  </div>
                  <div className="provider-settings-actions">
                    <span
                      className={`provider-health-badge ${
                        providerHealth?.available ? 'ready' : 'quiet'
                      }`}
                    >
                      {statusLabel(providerHealth)}
                    </span>
                    <label className="provider-toggle">
                      <input
                        type="checkbox"
                        checked={provider.enabled}
                        disabled={busy || environmentLocked}
                        onChange={(event) => {
                          void updateProvider(provider.providerId, {
                            enabled: event.target.checked,
                          });
                        }}
                      />
                      <span aria-hidden="true"></span>
                      <span className="sr-only">
                        {provider.enabled ? 'Disable' : 'Enable'} {provider.displayName}
                      </span>
                    </label>
                  </div>
                </div>

                <p className="provider-settings-detail">
                  {providerHealth?.detail ?? provider.setupHint}
                </p>

                <div className="provider-command-row">
                  <label htmlFor={`provider-command-${provider.providerId}`}>
                    <span>Command override</span>
                    <input
                      id={`provider-command-${provider.providerId}`}
                      value={commandDraft}
                      disabled={busy || environmentLocked}
                      placeholder={
                        provider.providerId === 'freebuff'
                          ? 'Path to a Freebuff automation bridge'
                          : `Use ${provider.displayName} from PATH`
                      }
                      onChange={(event) => {
                        setCommandDrafts((current) => ({
                          ...current,
                          [provider.providerId]: event.target.value,
                        }));
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!commandChanged || busy || environmentLocked}
                    onClick={() => {
                      void updateProvider(provider.providerId, {
                        command: commandDraft.trim() || null,
                      });
                    }}
                  >
                    Save
                  </button>
                </div>

                <footer className="provider-settings-card-footer">
                  <a href={provider.documentationUrl} target="_blank" rel="noreferrer">
                    Setup guide
                  </a>
                  <button
                    type="button"
                    className="provider-default-action"
                    disabled={
                      defaultBusy ||
                      environmentLocked ||
                      !provider.enabled ||
                      registry.defaultProviderId === provider.providerId
                    }
                    onClick={() => void updateDefault(provider.providerId)}
                  >
                    Make default
                  </button>
                  <span>
                    {environmentLocked
                      ? 'Managed by environment variables'
                      : `Workspace policy: ${registry.configPath}`}
                  </span>
                </footer>
              </article>
            );
          }) ?? (
            <div className="provider-settings-empty">Provider registry unavailable.</div>
          )}
        </div>
      </section>
    </div>
  );
}
