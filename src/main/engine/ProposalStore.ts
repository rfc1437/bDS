import { randomUUID } from 'crypto';

export type ProposalType =
  | 'draftPost'
  | 'proposeScript'
  | 'proposeTemplate'
  | 'proposeMediaMetadata'
  | 'proposePostMetadata';

export interface Proposal {
  id: string;
  type: ProposalType;
  data: Record<string, unknown>;
  createdAt: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class ProposalStore {
  private readonly proposals = new Map<string, Proposal>();
  private readonly ttlMs: number;
  private readonly onExpiry: ((proposal: Proposal) => void) | undefined;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs?: number, onExpiry?: (proposal: Proposal) => void) {
    this.ttlMs = ttlMs ?? DEFAULT_TTL_MS;
    this.onExpiry = onExpiry;
    this.cleanupInterval = setInterval(() => this.cleanup(), this.ttlMs);
  }

  create(type: ProposalType, data: Record<string, unknown>): string {
    const id = randomUUID();
    this.proposals.set(id, {
      id,
      type,
      data,
      createdAt: Date.now(),
    });
    return id;
  }

  get(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }

  remove(id: string): void {
    this.proposals.delete(id);
  }

  getAll(): Proposal[] {
    return Array.from(this.proposals.values());
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, proposal] of this.proposals) {
      if (now - proposal.createdAt > this.ttlMs) {
        this.onExpiry?.(proposal);
        this.proposals.delete(id);
      }
    }
  }

  destroy(): void {
    this.proposals.clear();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
