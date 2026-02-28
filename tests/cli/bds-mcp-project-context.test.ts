import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Verifies that the MCP standalone CLI calls setProjectContext() on every
 * engine after resolving the active project from the database.
 */

// ── Spies that each mock-engine instance populates ──────────────────────────

let postEngineSetProjectContext: ReturnType<typeof vi.fn>;
let mediaEngineSetProjectContext: ReturnType<typeof vi.fn>;
let postMediaEngineSetProjectContext: ReturnType<typeof vi.fn>;
let tagEngineSetProjectContext: ReturnType<typeof vi.fn>;
let scriptEngineSetProjectContext: ReturnType<typeof vi.fn>;
let templateEngineSetProjectContext: ReturnType<typeof vi.fn>;
let metaEngineSetProjectContext: ReturnType<typeof vi.fn>;

function resetSpies(): void {
  postEngineSetProjectContext = vi.fn();
  mediaEngineSetProjectContext = vi.fn();
  postMediaEngineSetProjectContext = vi.fn();
  tagEngineSetProjectContext = vi.fn();
  scriptEngineSetProjectContext = vi.fn();
  templateEngineSetProjectContext = vi.fn();
  metaEngineSetProjectContext = vi.fn();
}

// ── Active project data ─────────────────────────────────────────────────────

const ACTIVE_PROJECT_CUSTOM_PATH = {
  id: 'my-blog',
  name: 'My Blog',
  slug: 'my-blog',
  description: 'Test project',
  dataPath: '/custom/data/path',
  createdAt: new Date(),
  updatedAt: new Date(),
  isActive: true,
};

const ACTIVE_PROJECT_DEFAULT_PATH = {
  id: 'internal-project',
  name: 'Internal Project',
  slug: 'internal-project',
  description: null,
  dataPath: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  isActive: true,
};

// ── Chainable query mock ────────────────────────────────────────────────────

let mockActiveProject: typeof ACTIVE_PROJECT_CUSTOM_PATH | typeof ACTIVE_PROJECT_DEFAULT_PATH = ACTIVE_PROJECT_CUSTOM_PATH;

function makeMockLocalDb() {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(mockActiveProject),
        }),
      }),
    }),
  };
}

// ── Hoisted mocks ───────────────────────────────────────────────────────────

vi.mock('../../src/cli/platform', () => ({
  platformConfigPath: vi.fn(() => '/tmp/mock-userdata'),
}));

vi.mock('../../src/main/database/connection', () => {
  const mockDb = {
    initializeLocal: vi.fn().mockResolvedValue(undefined),
    getLocal: vi.fn(() => makeMockLocalDb()),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    initDatabase: vi.fn(() => mockDb),
    getDatabase: vi.fn(() => mockDb),
    DatabaseConnection: vi.fn(),
  };
});

vi.mock('../../src/main/database/schema', () => ({
  projects: { isActive: 'isActive' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => 'isActive=true'),
}));

vi.mock('../../src/main/engine/CliNotifier', () => ({
  DbNotifier: vi.fn().mockImplementation(function(this: Record<string, unknown>) { return this; }),
}));

vi.mock('../../src/main/engine/PostEngine', () => ({
  PostEngine: vi.fn().mockImplementation(function(this: Record<string, unknown>) {
    this.setProjectContext = (...args: unknown[]) => postEngineSetProjectContext(...args);
    return this;
  }),
}));

vi.mock('../../src/main/engine/MediaEngine', () => ({
  MediaEngine: vi.fn().mockImplementation(function(this: Record<string, unknown>) {
    this.setProjectContext = (...args: unknown[]) => mediaEngineSetProjectContext(...args);
    return this;
  }),
}));

vi.mock('../../src/main/engine/PostMediaEngine', () => ({
  PostMediaEngine: vi.fn().mockImplementation(function(this: Record<string, unknown>) {
    this.setProjectContext = (...args: unknown[]) => postMediaEngineSetProjectContext(...args);
    return this;
  }),
}));

vi.mock('../../src/main/engine/TagEngine', () => ({
  TagEngine: vi.fn().mockImplementation(function(this: Record<string, unknown>) {
    this.setProjectContext = (...args: unknown[]) => tagEngineSetProjectContext(...args);
    return this;
  }),
}));

vi.mock('../../src/main/engine/ScriptEngine', () => ({
  ScriptEngine: vi.fn().mockImplementation(function(this: Record<string, unknown>) {
    this.setProjectContext = (...args: unknown[]) => scriptEngineSetProjectContext(...args);
    return this;
  }),
}));

vi.mock('../../src/main/engine/TemplateEngine', () => ({
  TemplateEngine: vi.fn().mockImplementation(function(this: Record<string, unknown>) {
    this.setProjectContext = (...args: unknown[]) => templateEngineSetProjectContext(...args);
    return this;
  }),
}));

vi.mock('../../src/main/engine/MetaEngine', () => ({
  MetaEngine: vi.fn().mockImplementation(function(this: Record<string, unknown>) {
    this.setProjectContext = (...args: unknown[]) => metaEngineSetProjectContext(...args);
    return this;
  }),
}));

vi.mock('../../src/main/engine/MCPServer', () => ({
  MCPServer: vi.fn().mockImplementation(function(this: Record<string, unknown>) {
    this.startCli = vi.fn().mockResolvedValue(undefined);
    this.cleanup = vi.fn().mockResolvedValue(undefined);
    return this;
  }),
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('bds-mcp project context initialisation', () => {
  const originalExit = process.exit;

  beforeEach(() => {
    resetSpies();
    // Prevent process.exit from actually killing the test runner
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    process.exit = originalExit;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('calls setProjectContext on all engines with the active project (custom dataPath)', async () => {
    mockActiveProject = ACTIVE_PROJECT_CUSTOM_PATH;

    await import('../../src/cli/bds-mcp');
    // Give main() a tick to complete
    await new Promise((r) => setTimeout(r, 100));

    const expectedProjectId = 'my-blog';
    const expectedDataDir = '/custom/data/path';

    expect(postEngineSetProjectContext).toHaveBeenCalledWith(expectedProjectId, expectedDataDir);
    expect(mediaEngineSetProjectContext).toHaveBeenCalledWith(expectedProjectId, expectedDataDir, expectedDataDir);
    expect(postMediaEngineSetProjectContext).toHaveBeenCalledWith(expectedProjectId);
    expect(tagEngineSetProjectContext).toHaveBeenCalledWith(expectedProjectId, expectedDataDir);
    expect(scriptEngineSetProjectContext).toHaveBeenCalledWith(expectedProjectId, expectedDataDir);
    expect(templateEngineSetProjectContext).toHaveBeenCalledWith(expectedProjectId, expectedDataDir);
    expect(metaEngineSetProjectContext).toHaveBeenCalledWith(expectedProjectId, expectedDataDir);
  });

  it('uses internal userData path when project has no custom dataPath', async () => {
    mockActiveProject = ACTIVE_PROJECT_DEFAULT_PATH;

    await import('../../src/cli/bds-mcp');
    await new Promise((r) => setTimeout(r, 100));

    const expectedDataDir = '/tmp/mock-userdata/projects/internal-project';

    expect(postEngineSetProjectContext).toHaveBeenCalledWith('internal-project', expectedDataDir);
    expect(mediaEngineSetProjectContext).toHaveBeenCalledWith('internal-project', expectedDataDir, expectedDataDir);
    expect(postMediaEngineSetProjectContext).toHaveBeenCalledWith('internal-project');
    expect(tagEngineSetProjectContext).toHaveBeenCalledWith('internal-project', expectedDataDir);
    expect(scriptEngineSetProjectContext).toHaveBeenCalledWith('internal-project', expectedDataDir);
    expect(templateEngineSetProjectContext).toHaveBeenCalledWith('internal-project', expectedDataDir);
    expect(metaEngineSetProjectContext).toHaveBeenCalledWith('internal-project', expectedDataDir);
  });
});
