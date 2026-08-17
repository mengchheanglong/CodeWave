import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolActivityList } from './ToolActivityList';
import type { ShellPanelsState } from '../lib/shell-panels-state';

describe('ToolActivityList Component Tests', () => {
  const mockTools: ShellPanelsState['tools'] = [
    {
      id: 'tool-1',
      toolName: 'read_file',
      toolUseId: 'use-abc-123',
      status: 'completed',
      detail: 'Read package.json',
      input: { path: 'package.json' },
      output: { content: '{}' },
    },
    {
      id: 'tool-2',
      toolName: 'write_file',
      status: 'running',
      input: { path: 'src/index.ts', content: 'console.log(1)' },
    },
    {
      id: 'tool-3',
      toolName: '',
      status: '',
      input: 'plain string payload',
    },
  ];

  it('renders empty state when tools list is empty', () => {
    render(<ToolActivityList tools={[]} />);
    expect(screen.getByText('No tool activity yet')).toBeInTheDocument();
  });

  it('renders tool cards with tool names, IDs, status chips, and payloads', () => {
    render(<ToolActivityList tools={mockTools} />);

    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('use-abc-123')).toBeInTheDocument();
    expect(screen.getByText('Read package.json')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();

    expect(screen.getByText('write_file')).toBeInTheDocument();
    expect(screen.getAllByText('daemon-observed tool event').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('running')).toBeInTheDocument();

    expect(screen.getAllByText('unknown').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('plain string payload')).toBeInTheDocument();
  });

  it('limits rendering to latest 20 tool items', () => {
    const twentyFiveTools: ShellPanelsState['tools'] = Array.from({ length: 25 }, (_, i) => ({
      id: `tool-${i}`,
      toolName: `tool_name_${i}`,
      status: 'completed',
      detail: `Detail ${i}`,
    }));

    render(<ToolActivityList tools={twentyFiveTools} />);

    expect(screen.getByText('tool_name_24')).toBeInTheDocument();
    expect(screen.getByText('tool_name_5')).toBeInTheDocument();
    expect(screen.queryByText('tool_name_4')).not.toBeInTheDocument();
  });
});
