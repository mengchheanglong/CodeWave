import type { ProviderId, RoutingToolRequirement } from '@codewave/protocol';
import type { ShellPanelsState } from '../lib/shell-panels-state';

type ToolRegistrationEvidenceListProps = {
  snapshot: ShellPanelsState['toolPlane'];
  selectedProviderId: ProviderId | null;
};

type GroupedEvidence = {
  providerId: ProviderId;
  total: number;
  providerEnumerated: number;
  providerRuntime: number;
  providerCli: number;
  providerUnknown: number;
  eventObserved: number;
  requirements: RoutingToolRequirement[];
};

function EmptyState({ message }: { message: string }) {
  return <div className="empty">{message}</div>;
}

function normalizeRequirementOrder(requirements: RoutingToolRequirement[]) {
  const order: RoutingToolRequirement[] = [
    'workspace-read',
    'workspace-write',
    'shell',
    'network',
    'mcp',
  ];
  const unique = [...new Set(requirements)];
  return order.filter((requirement) => unique.includes(requirement));
}

function groupEvidence(
  registrations: NonNullable<ShellPanelsState['toolPlane']>['registeredSessionTools'],
): GroupedEvidence[] {
  const grouped = new Map<ProviderId, GroupedEvidence>();

  for (const registration of registrations) {
    const providerId = registration.providerId;
    const current = grouped.get(providerId) || {
      providerId,
      total: 0,
      providerEnumerated: 0,
      providerRuntime: 0,
      providerCli: 0,
      providerUnknown: 0,
      eventObserved: 0,
      requirements: [],
    };

    current.total += 1;

    if (registration.metadata?.confirmedBy === 'provider-runtime') {
      current.providerRuntime += 1;
    } else if (registration.metadata?.confirmedBy === 'provider-cli') {
      current.providerCli += 1;
    } else {
      current.providerUnknown += 1;
    }

    if (registration.metadata?.registrationKind === 'provider-enumeration') {
      current.providerEnumerated += 1;
    } else if (registration.metadata?.registrationKind === 'event-observed') {
      current.eventObserved += 1;
    }

    if (registration.requirement) {
      current.requirements.push(registration.requirement);
    }

    grouped.set(providerId, current);
  }

  return [...grouped.values()].sort((left, right) =>
    left.providerId.localeCompare(right.providerId),
  );
}

export function ToolRegistrationEvidenceList({
  snapshot,
  selectedProviderId,
}: ToolRegistrationEvidenceListProps) {
  if (!snapshot) {
    return <EmptyState message="Tool-plane snapshot is not loaded yet." />;
  }

  if (snapshot.scope !== 'session') {
    return (
      <EmptyState message="Select a session to inspect provider-enumerated versus event-observed tool registration evidence." />
    );
  }

  const registrations = Array.isArray(snapshot.registeredSessionTools)
    ? snapshot.registeredSessionTools
    : [];
  if (registrations.length === 0) {
    return <EmptyState message="No live session tool registrations yet." />;
  }

  return (
    <>
      {groupEvidence(registrations).map((row) => {
        const normalizedRequirements = normalizeRequirementOrder(row.requirements);
        return (
          <div
            className={`list-item tool-evidence-card qw-inspector-card ${
              selectedProviderId && selectedProviderId === row.providerId ? 'active' : ''
            }`}
            key={row.providerId}
          >
            <div className="qw-inspector-card-header">
              <div className="qw-inspector-card-title-group">
                <strong>{row.providerId}</strong>
                <span className="qw-inspector-subline">
                  {row.total} registrations, {row.providerEnumerated} enumerated, {row.eventObserved}{' '}
                  observed
                </span>
              </div>
              <span className="event-chip">{selectedProviderId === row.providerId ? 'active' : 'provider'}</span>
            </div>
            <span className="qw-inspector-subline">
              confirmed by runtime {row.providerRuntime}, cli {row.providerCli}, unknown {row.providerUnknown}
            </span>
            <span className="qw-inspector-subline tool-evidence-requirements">
              {normalizedRequirements.length > 0
                ? `requirements: ${normalizedRequirements.join(', ')}`
                : 'requirements: none yet'}
            </span>
          </div>
        );
      })}
    </>
  );
}
