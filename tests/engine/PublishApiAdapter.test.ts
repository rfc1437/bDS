import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublishApiAdapter } from '../../src/main/engine/PublishApiAdapter';

const { mockPublishEngine, mockProjectEngine, mockTaskManager } = vi.hoisted(() => ({
  mockPublishEngine: {
    setProjectContext: vi.fn(),
    uploadHtml: vi.fn().mockResolvedValue({ filesUploaded: 5, filesSkipped: 2 }),
    uploadThumbnails: vi.fn().mockResolvedValue({ filesUploaded: 3, filesSkipped: 1 }),
    uploadMedia: vi.fn().mockResolvedValue({ filesUploaded: 10, filesSkipped: 4 }),
  },
  mockProjectEngine: {
    getActiveProject: vi.fn().mockResolvedValue({ id: 'p1', dataPath: '/projects/blog' }),
  },
  mockTaskManager: {
    runTask: vi.fn().mockImplementation((opts: { execute: (onProgress: () => void) => Promise<unknown> }) => {
      return opts.execute(() => {});
    }),
  },
}));

vi.mock('../../src/main/engine/PublishEngine', () => ({
  getPublishEngine: () => mockPublishEngine,
}));

vi.mock('../../src/main/engine/ProjectEngine', () => ({
  getProjectEngine: () => mockProjectEngine,
}));

vi.mock('../../src/main/engine/TaskManager', () => ({
  taskManager: mockTaskManager,
}));

describe('PublishApiAdapter', () => {
  let adapter: PublishApiAdapter;
  const creds = { sshHost: 'example.com', sshUser: 'deploy', sshRemotePath: '/var/www', sshMode: 'rsync' as const };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPublishEngine.uploadHtml.mockResolvedValue({ filesUploaded: 5, filesSkipped: 2 });
    mockPublishEngine.uploadThumbnails.mockResolvedValue({ filesUploaded: 3, filesSkipped: 1 });
    mockPublishEngine.uploadMedia.mockResolvedValue({ filesUploaded: 10, filesSkipped: 4 });
    mockProjectEngine.getActiveProject.mockResolvedValue({ id: 'p1', dataPath: '/projects/blog' });
    mockTaskManager.runTask.mockImplementation((opts: { execute: (onProgress: () => void) => Promise<unknown> }) => {
      return opts.execute(() => {});
    });
    adapter = new PublishApiAdapter(mockProjectEngine as any, mockPublishEngine as any, mockTaskManager as any);
  });

  it('sets project context before uploading', async () => {
    await adapter.uploadSite(creds);
    expect(mockPublishEngine.setProjectContext).toHaveBeenCalledWith('p1', '/projects/blog');
  });

  it('runs three parallel upload tasks', async () => {
    await adapter.uploadSite(creds);
    expect(mockTaskManager.runTask).toHaveBeenCalledTimes(3);
  });

  it('returns aggregate upload results', async () => {
    const result = await adapter.uploadSite(creds);
    expect(result).toEqual({
      htmlFilesUploaded: 5,
      thumbnailFilesUploaded: 3,
      mediaFilesUploaded: 10,
      filesSkipped: 7, // 2 + 1 + 4
    });
  });

  it('passes credentials to upload methods', async () => {
    await adapter.uploadSite(creds);
    expect(mockPublishEngine.uploadHtml).toHaveBeenCalledWith(creds, expect.any(Function));
    expect(mockPublishEngine.uploadThumbnails).toHaveBeenCalledWith(creds, expect.any(Function));
    expect(mockPublishEngine.uploadMedia).toHaveBeenCalledWith(creds, expect.any(Function));
  });

  it('throws when no active project', async () => {
    mockProjectEngine.getActiveProject.mockResolvedValueOnce(null);
    await expect(adapter.uploadSite(creds)).rejects.toThrow('No active project');
  });
});
