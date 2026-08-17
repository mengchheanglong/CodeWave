import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ArtifactListPanel } from './ArtifactListPanel';
import type { ShellPanelsState } from '../lib/shell-panels-state';

describe('ArtifactListPanel Component Tests', () => {
  const shortContent = 'export function sum(a: number, b: number) { return a + b; }';
  const longContent = 'A'.repeat(5000);

  const mockArtifacts: ShellPanelsState['artifacts'] = [
    {
      id: 'art-1',
      runId: 'run-1',
      title: 'math.ts',
      content: shortContent,
      createdAt: '2026-08-17T00:00:00.000Z',
    },
    {
      id: 'art-2',
      runId: 'run-1',
      title: 'large_dataset.json',
      content: longContent,
      createdAt: '2026-08-17T01:00:00.000Z',
    },
  ];

  it('renders empty state when no artifacts exist', () => {
    render(<ArtifactListPanel artifacts={[]} formatTimestamp={(t) => t} />);
    expect(screen.getByText('No artifacts captured')).toBeInTheDocument();
  });

  it('renders short artifacts without truncation', () => {
    render(
      <ArtifactListPanel
        artifacts={[mockArtifacts[0]!]}
        formatTimestamp={() => '1m ago'}
      />,
    );

    expect(screen.getByText('math.ts')).toBeInTheDocument();
    expect(screen.getByText(shortContent)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show full content/i })).not.toBeInTheDocument();
  });

  it('truncates large artifacts and expands when Show full content is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ArtifactListPanel
        artifacts={[mockArtifacts[1]!]}
        formatTimestamp={() => '5m ago'}
      />,
    );

    expect(screen.getByText('large_dataset.json')).toBeInTheDocument();
    expect(screen.getByText(/\[Content Truncated\]/i)).toBeInTheDocument();

    const expandBtn = screen.getByRole('button', { name: /show full content/i });
    expect(expandBtn).toBeInTheDocument();

    await user.click(expandBtn);

    expect(screen.queryByText(/\[Content Truncated\]/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show full content/i })).not.toBeInTheDocument();
  });
});
