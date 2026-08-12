import type { ChildProcess } from 'node:child_process';
import type { ProviderRunContext } from '@codewave/protocol';
import {
  startAcpRun,
  type AcpEventPublisher,
  type AcpRunHandle,
  type AcpTransportTrace,
} from '@codewave/provider-transport';

export type GeminiAcpRunHandle = AcpRunHandle;

export function startGeminiAcpRun(options: {
  child: ChildProcess;
  context: ProviderRunContext;
  publish: AcpEventPublisher;
  trace?: (entry: AcpTransportTrace) => void;
}): Promise<GeminiAcpRunHandle> {
  return startAcpRun({
    ...options,
    profile: {
      providerId: 'gemini',
      displayName: 'Gemini',
      surface: 'gemini.acp',
    },
  });
}
