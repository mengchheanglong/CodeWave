import { describe, expect, it } from 'vitest';
import { parseProviderId, renderProviderLabel } from './shell-format';

describe('dynamic ACP provider formatting', () => {
  it('preserves validated custom IDs instead of coercing them to Freebuff', () => {
    expect(parseProviderId('acp.browser-wave')).toBe('acp.browser-wave');
    expect(parseProviderId('acp.INVALID')).toBe('freebuff');
  });

  it('provides a readable fallback when registry metadata is unavailable', () => {
    expect(renderProviderLabel('acp.browser-wave')).toBe('Browser Wave');
  });
});
