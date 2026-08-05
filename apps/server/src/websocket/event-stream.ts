import { randomUUID } from "node:crypto";

export interface SequencedEvent { type: string; sequence: number; generationId: string; [key: string]: unknown }
export class EventStream {
  private sequenceValue = 0;
  private generationValue = randomUUID();
  private readonly events: SequencedEvent[] = [];
  constructor(private readonly capacity = 10_000) {}
  get sequence(): number { return this.sequenceValue; }
  get generationId(): string { return this.generationValue; }
  resetGeneration(): void { this.generationValue = randomUUID(); this.sequenceValue = 0; this.events.length = 0; }
  append(type: string, body: Record<string, unknown>): SequencedEvent { const event = { type, sequence: ++this.sequenceValue, generationId: this.generationValue, ...body }; this.events.push(event); if (this.events.length > this.capacity) this.events.shift(); return event; }
  replay(generationId: string | undefined, after = 0): SequencedEvent[] | null { if (generationId !== this.generationValue) return null; if (this.events.length && after < this.events[0].sequence - 1) return null; return this.events.filter((event) => event.sequence > after); }
}
