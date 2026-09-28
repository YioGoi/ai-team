import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { errorCodeSchema, TeamError } from '../domain/schemas.js';
export const providerEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('metadata'),
    sessionId: z.string().nullable(),
    model: z.string().nullable(),
  }),
  z.strictObject({ type: z.literal('result'), value: z.unknown() }),
  z.strictObject({ type: z.literal('success') }),
  z.strictObject({ type: z.literal('error'), code: errorCodeSchema, message: z.string() }),
  z.strictObject({ type: z.literal('diagnostic'), value: z.unknown() }),
]);
export type NormalizedProviderEvent = z.infer<typeof providerEventSchema>;
export interface ProviderEventDecoder {
  push(chunk: Buffer): void;
  finish(): NormalizedProviderEvent[];
}
export class JsonlDecoder implements ProviderEventDecoder {
  private readonly utf8 = new StringDecoder('utf8');
  private pending = '';
  private bytes = 0;
  private events: NormalizedProviderEvent[] = [];
  constructor(
    private readonly normalize: (value: unknown) => NormalizedProviderEvent[],
    private readonly maxBytes = 5_242_880,
  ) {}
  push(chunk: Buffer): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) throw new TeamError('OUTPUT_LIMIT', 'Provider stream cap');
    this.pending += this.utf8.write(chunk);
    this.drain();
  }
  private drain(): void {
    let newline: number;
    while ((newline = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, newline).trim();
      this.pending = this.pending.slice(newline + 1);
      if (line) this.decode(line);
    }
  }
  private decode(line: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new TeamError('INVALID_RESULT', 'Malformed provider JSONL');
    }
    this.events.push(...this.normalize(raw).map((e) => providerEventSchema.parse(e)));
  }
  finish(): NormalizedProviderEvent[] {
    this.pending += this.utf8.end();
    this.drain();
    if (this.pending.trim()) this.decode(this.pending.trim());
    this.pending = '';
    return this.events;
  }
}
export function extractStructured(events: NormalizedProviderEvent[]): unknown {
  const error = events.find((e) => e.type === 'error');
  if (error?.type === 'error') throw new TeamError(error.code, error.message);
  if (events.filter((e) => e.type === 'success').length !== 1)
    throw new TeamError('INVALID_RESULT', 'Missing or ambiguous terminal success');
  const results = events.filter((e) => e.type === 'result');
  if (results.length !== 1 || results[0]?.type !== 'result')
    throw new TeamError('INVALID_RESULT', 'Missing or ambiguous final structured result');
  return results[0].value;
}
