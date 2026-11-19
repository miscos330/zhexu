/**
 * Loading a course for a handout (`extensions/zhexu/deliverables/course-store.ts`).
 * Upstream's store reads a course for anyone who holds its id; a handout copies
 * the whole text, so only a course in the owner's own list may be loaded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  loadDocument: vi.fn(),
  boundTo: [] as string[],
}));

vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getOwnerScopedDocumentStore: vi.fn(async (ownerId: string) => {
    store.boundTo.push(ownerId);
    return { listDocuments: store.listDocuments, loadDocument: store.loadDocument };
  }),
}));

import { loadOwnedCourse } from '@/extensions/zhexu/deliverables/course-store';

beforeEach(() => {
  store.listDocuments.mockReset();
  store.loadDocument.mockReset();
  store.boundTo.length = 0;
});

describe('loading a course for a handout', () => {
  it('returns the name, the description and the pages of a course the owner has', async () => {
    store.listDocuments.mockResolvedValue([{ id: 'mine' }, { id: 'also-mine' }]);
    store.loadDocument.mockResolvedValue({
      stage: { id: 'mine', name: '光的折射', description: '一节短课' },
      scenes: [{ id: 's1' }],
    });
    await expect(loadOwnedCourse('user:one', 'mine')).resolves.toEqual({
      name: '光的折射',
      description: '一节短课',
      scenes: [{ id: 's1' }],
    });
    expect(store.boundTo).toEqual(['user:one']);
    expect(store.loadDocument).toHaveBeenCalledWith('mine');
  });

  it('does not read a course that is not in the owner’s own list, even with its id', async () => {
    store.listDocuments.mockResolvedValue([{ id: 'mine' }]);
    store.loadDocument.mockResolvedValue({ stage: { name: 'theirs' }, scenes: [] });
    await expect(loadOwnedCourse('user:one', 'theirs')).resolves.toBeNull();
    expect(store.loadDocument).not.toHaveBeenCalled();
  });

  it('returns nothing for a listed course that has since gone', async () => {
    store.listDocuments.mockResolvedValue([{ id: 'mine' }]);
    store.loadDocument.mockResolvedValue(null);
    await expect(loadOwnedCourse('user:one', 'mine')).resolves.toBeNull();
  });
});
