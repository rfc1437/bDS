import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProposalStore, type Proposal, type ProposalType } from '../../src/main/engine/ProposalStore';

describe('ProposalStore', () => {
  let store: ProposalStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new ProposalStore();
  });

  afterEach(() => {
    store.destroy();
    vi.useRealTimers();
  });

  describe('create', () => {
    it('creates a proposal and returns an id', () => {
      const id = store.create('draftPost', { postId: 'post-1' });
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('generates unique ids for each proposal', () => {
      const id1 = store.create('draftPost', { postId: 'post-1' });
      const id2 = store.create('draftPost', { postId: 'post-2' });
      expect(id1).not.toBe(id2);
    });
  });

  describe('get', () => {
    it('returns a created proposal', () => {
      const id = store.create('proposeScript', { title: 'My Script', content: 'print("hello")' });
      const proposal = store.get(id);
      expect(proposal).toBeDefined();
      expect(proposal!.type).toBe('proposeScript');
      expect(proposal!.data).toEqual({ title: 'My Script', content: 'print("hello")' });
    });

    it('returns undefined for non-existent id', () => {
      expect(store.get('non-existent')).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('removes a proposal', () => {
      const id = store.create('draftPost', { postId: 'post-1' });
      expect(store.get(id)).toBeDefined();
      store.remove(id);
      expect(store.get(id)).toBeUndefined();
    });

    it('does nothing when removing non-existent id', () => {
      expect(() => store.remove('non-existent')).not.toThrow();
    });
  });

  describe('getAll', () => {
    it('returns all proposals', () => {
      store.create('draftPost', { postId: 'post-1' });
      store.create('proposeScript', { title: 'Script' });
      const all = store.getAll();
      expect(all).toHaveLength(2);
    });

    it('returns empty array when no proposals exist', () => {
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('TTL expiry', () => {
    it('expires proposals after TTL', () => {
      const id = store.create('draftPost', { postId: 'post-1' });
      expect(store.get(id)).toBeDefined();

      // Advance past 30-minute TTL
      vi.advanceTimersByTime(31 * 60 * 1000);
      store.cleanup();

      expect(store.get(id)).toBeUndefined();
    });

    it('keeps proposals within TTL', () => {
      const id = store.create('draftPost', { postId: 'post-1' });

      // Advance less than TTL
      vi.advanceTimersByTime(15 * 60 * 1000);
      store.cleanup();

      expect(store.get(id)).toBeDefined();
    });

    it('supports custom TTL', () => {
      const shortStore = new ProposalStore(5 * 60 * 1000); // 5 minutes
      const id = shortStore.create('draftPost', { postId: 'post-1' });

      vi.advanceTimersByTime(6 * 60 * 1000);
      shortStore.cleanup();

      expect(shortStore.get(id)).toBeUndefined();
      shortStore.destroy();
    });
  });

  describe('cleanup', () => {
    it('removes only expired proposals', () => {
      const id1 = store.create('draftPost', { postId: 'post-1' });

      // Advance 20 minutes
      vi.advanceTimersByTime(20 * 60 * 1000);

      const id2 = store.create('proposeScript', { title: 'Script' });

      // Advance 15 more minutes (id1 = 35 min old = expired, id2 = 15 min old = ok)
      vi.advanceTimersByTime(15 * 60 * 1000);
      store.cleanup();

      expect(store.get(id1)).toBeUndefined();
      expect(store.get(id2)).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('clears all proposals', () => {
      store.create('draftPost', { postId: 'post-1' });
      store.create('proposeScript', { title: 'Script' });
      store.destroy();
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('proposal types', () => {
    const types: ProposalType[] = [
      'draftPost',
      'proposeScript',
      'proposeTemplate',
      'proposeMediaMetadata',
      'proposePostMetadata',
    ];

    it.each(types)('stores and retrieves %s type', (type) => {
      const id = store.create(type, { test: true });
      const proposal = store.get(id);
      expect(proposal).toBeDefined();
      expect(proposal!.type).toBe(type);
    });
  });
});
