import { z } from 'zod';
import { providerSchema } from '../domain/schemas.js';
import type { AgentRequest } from '../domain/schemas.js';
import type { InvocationSpec, ProcessResult } from '../process/supervisor.js';
import type { NormalizedProviderEvent, ProviderEventDecoder } from './decoder.js';
export const capabilitiesSchema = z.strictObject({
  provider: providerSchema,
  executablePath: z.string().nullable(),
  version: z.string().nullable(),
  available: z.boolean(),
  freshSession: z.boolean(),
  structuredResult: z.boolean(),
  readOnlyProfile: z.boolean(),
  workspaceWriteProfile: z.boolean(),
  configuredAuth: z.enum(['saved-cli-login', 'other', 'unknown']),
  limitations: z.array(z.string()),
});
export type ProviderCapabilities = z.infer<typeof capabilitiesSchema>;
export interface ProviderAdapter {
  probe(): Promise<ProviderCapabilities>;
  buildInvocation(request: AgentRequest): InvocationSpec;
  createDecoder(): ProviderEventDecoder;
  extractResult(
    events: NormalizedProviderEvent[],
    execution?: Pick<ProcessResult, 'exitCode' | 'stderr'>,
  ): unknown;
}
