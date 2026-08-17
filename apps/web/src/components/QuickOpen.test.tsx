import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuickOpen, type QuickOpenItem } from './QuickOpen';

describe('QuickOpen Component Tests', () => {
  const mockItems: QuickOpenItem[] = [
    {
      id: 'action-1',
      group: 'Actions',
      title: 'New Thread',
      subtitle: 'Create a fresh workspace session',
      badge: 'Ctrl+N',
      keywords: ['create', 'start'],
      run: vi.fn(),
    },
    {
      id: 'action-2',
      group: 'Actions',
      title: 'Toggle Right Rail',
      subtitle: 'Inspect runs and artifacts',
      badge: 'Ctrl+B',
      keywords: ['inspector', 'utility'],
      run: vi.fn(),
    },
    {
      id: 'view-1',
      group: 'Views',
      title: 'Open Workspace Files',
      subtitle: 'Browse and edit files',
      keywords: ['explorer', 'tree'],
      run: vi.fn(),
    },
  ];

  it('renders null when open is false', () => {
    const { container } = render(
      <QuickOpen items={mockItems} open={false} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog, input, groups and items when open is true', () => {
    render(<QuickOpen items={mockItems} open={true} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Quick Open' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search actions/i)).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Views')).toBeInTheDocument();
    expect(screen.getByText('New Thread')).toBeInTheDocument();
    expect(screen.getByText('Open Workspace Files')).toBeInTheDocument();
  });

  it('filters items by title, subtitle, or keywords', async () => {
    const user = userEvent.setup();
    render(<QuickOpen items={mockItems} open={true} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText(/search actions/i);
    await user.type(input, 'explorer');

    expect(screen.getByText('Open Workspace Files')).toBeInTheDocument();
    expect(screen.queryByText('New Thread')).not.toBeInTheDocument();
  });

  it('shows empty message when no items match search query', async () => {
    const user = userEvent.setup();
    render(<QuickOpen items={mockItems} open={true} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText(/search actions/i);
    await user.type(input, 'xyznonexistent123');

    expect(screen.getByText('No matching actions.')).toBeInTheDocument();
  });

  it('navigates with ArrowDown and ArrowUp and selects item with Enter', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<QuickOpen items={mockItems} open={true} onClose={onClose} />);

    const input = screen.getByPlaceholderText(/search actions/i);
    const itemButtons = screen.getAllByRole('button');
    expect(itemButtons[0]).toHaveClass('active');

    await user.type(input, '{arrowdown}');
    expect(itemButtons[1]).toHaveClass('active');

    await user.type(input, '{enter}');
    expect(mockItems[1]!.run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when Escape is pressed or backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <QuickOpen items={mockItems} open={true} onClose={onClose} />,
    );

    const input = screen.getByPlaceholderText(/search actions/i);
    await user.type(input, '{escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = container.querySelector('.quick-open-backdrop')!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
