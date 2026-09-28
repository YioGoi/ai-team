import { fileURLToPath } from 'node:url';
import { childEnvironment } from '../process/supervisor.js';
import { extractStructured, JsonlDecoder, providerEventSchema } from './decoder.js';
import type { ProviderAdapter } from './port.js';
export function mockAdapter(
  workerPath = fileURLToPath(new URL('../assets/mock-worker.mjs', import.meta.url)),
  scenario = 'normal',
): ProviderAdapter {
  return {
    async probe() {
      return {
        provider: 'mock',
        executablePath: process.execPath,
        version: process.version,
        available: true,
        freshSession: true,
        structuredResult: true,
        readOnlyProfile: true,
        workspaceWriteProfile: true,
        configuredAuth: 'saved-cli-login',
        limitations: ['SIMULATION only; not provider evidence'],
      };
    },
    buildInvocation(request) {
      return {
        executable: process.execPath,
        args: [workerPath, scenario],
        cwd: request.workspacePath,
        stdin: JSON.stringify(request),
        env: childEnvironment(),
      };
    },
    createDecoder() {
      return new JsonlDecoder((raw) => [providerEventSchema.parse(raw)]);
    },
    extractResult: extractStructured,
  };
}
