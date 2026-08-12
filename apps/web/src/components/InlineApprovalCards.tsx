import { ApprovalCard } from '@qwemini/ui-kit';
import type { ShellPanelsState } from '../lib/shell-panels-state';

type InlineApprovalCardsProps = {
  approvals: ShellPanelsState['approvals'];
  onResolveApproval: (
    approvalId: string,
    decision: 'approved' | 'denied',
  ) => void;
};

export function InlineApprovalCards({
  approvals,
  onResolveApproval,
}: InlineApprovalCardsProps) {
  if (approvals.length === 0) {
    return null;
  }

  return (
    <div className="inline-approvals" aria-label="Inline approvals">
      {approvals
        .slice()
        .reverse()
        .map((approval) => (
          <ApprovalCard
            key={approval.id}
            toolName={approval.toolName}
            input={approval.payload?.input}
            reason={approval.reason}
            status={approval.status}
            onApprove={
              approval.status === 'requested'
                ? () => {
                    onResolveApproval(approval.id, 'approved');
                  }
                : undefined
            }
            onDeny={
              approval.status === 'requested'
                ? () => {
                    onResolveApproval(approval.id, 'denied');
                  }
                : undefined
            }
            hint="Shift+Enter to approve · Shift+D to deny"
          />
        ))}
    </div>
  );
}
