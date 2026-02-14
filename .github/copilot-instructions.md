# GitHub Copilot Instructions for Blogging Desktop Server (bDS)

This document provides context and best practices for GitHub Copilot when working on this Electron + TypeScript + SQLite blogging application.

## Project Overview

**Blogging Desktop Server (bDS)** is a desktop blogging application built with:
- **Electron** v28+ for cross-platform desktop
- **TypeScript** for all code (strict mode)
- **React** for the renderer UI
- **Drizzle ORM** for type-safe database access
- **@libsql/client** for SQLite (local database)
- **Zustand** for React state management

---

## ⚠️ MANDATORY: Test-First Development

**STOP!** Before writing ANY implementation code, you MUST:

1. **Write a failing test first** that describes the expected behavior
2. **Run the test** to confirm it fails (Red)
3. **Write minimal code** to make the test pass (Green)
4. **Refactor** while keeping tests green

> **No code without tests. No exceptions.**
>
> Tests must import and exercise the REAL implementation classes, not inline helper functions.
> Mock only external dependencies (database, filesystem), never the class under test.

See the [TDD Requirements](#test-driven-development-tdd-requirements) section for detailed guidelines.

---

## ⚠️ MANDATORY: Fix All Test Failures

**You MUST investigate and fix ALL test failures before completing any task.**

- Never leave tests failing, even if they appear unrelated to your changes
- If a test failure is pre-existing, fix it as part of your current work
- Run the full test suite (`npm test`) before considering any task complete
- If you cannot fix a test, explain why and propose a solution

> **Zero failing tests. No exceptions.**

---

## ⚠️ MANDATORY: Remove Unused Code

**Never keep unused code around. Always delete it completely.**

- When a feature is removed, delete ALL related code (implementation, tests, types, configs)
- Do NOT comment out code "for later" - use version control history
- Do NOT skip tests for removed functionality - delete them
- Do NOT leave dead code paths, unused imports, or orphaned functions
- When refactoring, actively look for and remove any code that becomes unused

> **Delete unused code immediately. No exceptions.**

---

## ⚠️ MANDATORY: Build Verification After Code Changes

**You MUST run the full build after making code changes.**

- Run `npm run build` after any code modifications
- Fix ALL build errors before considering the task complete
- Build errors indicate issues that may not be caught by `tsc --noEmit` alone (e.g., event forwarding, renderer build)
- The build must complete successfully before the task is complete

> **Successful build required. No exceptions.**

---

## Architecture Principles

### Separation of Concerns

1. **Engine Classes** (`src/main/engine/`): All business logic lives here
   - `PostEngine`: Blog post CRUD, file I/O, markdown handling
   - `MediaEngine`: Media import, metadata management
   - `SyncEngine`: Remote database synchronization
   - `TaskManager`: Async task queue with progress tracking

2. **IPC Layer** (`src/main/ipc/`): Bridge between main and renderer
   - Handlers call engine methods, never contain business logic
   - Always use `ipcMain.handle` for async operations

3. **UI Components** (`src/renderer/components/`): Presentation only
   - Components should be stateless where possible
   - Use Zustand store for shared state
   - Never call IPC directly from deeply nested components

### File Storage Pattern

- **Posts**: Markdown files with YAML frontmatter in `posts/` directory
- **Media**: Binary files with `.meta` JSON sidecar files in `media/` directory
- **Database**: Index/cache only, source of truth is filesystem

## TypeScript Best Practices

### Type Safety

```typescript
// ✅ DO: Use explicit return types for public methods
async function getPost(id: string): Promise<PostData | null> {
  // ...
}

// ✅ DO: Use discriminated unions for status types
type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error';

// ✅ DO: Use Drizzle's inferred types
import { posts, type Post, type NewPost } from './schema';

// ❌ DON'T: Use `any` type
function processData(data: any) { } // Bad

// ❌ DON'T: Ignore null/undefined possibilities
const post = await getPost(id);
console.log(post.title); // Bad - post might be null
```

### Async/Await Patterns

```typescript
// ✅ DO: Use try-catch with specific error handling
try {
  await fileOperation();
} catch (error) {
  if (error instanceof Error && error.message.includes('ENOENT')) {
    // Handle file not found
  }
  throw error;
}

// ✅ DO: Use Promise.all for concurrent operations
const [posts, media] = await Promise.all([
  postEngine.getAllPosts(),
  mediaEngine.getAllMedia()
]);

// ❌ DON'T: Forget to await async operations
savePost(post); // Bad - fire and forget
```

### Error Handling

```typescript
// ✅ DO: Create typed error classes
class SyncError extends Error {
  constructor(
    message: string,
    public readonly code: 'AUTH_FAILED' | 'NETWORK_ERROR' | 'CONFLICT'
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

// ✅ DO: Return result objects for operations that can fail
interface OperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

## Electron Best Practices

### IPC Communication

```typescript
// ✅ DO: Use contextBridge for secure IPC exposure
// preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
  posts: {
    getAll: () => ipcRenderer.invoke('posts:getAll'),
    create: (data: CreatePostInput) => ipcRenderer.invoke('posts:create', data),
  }
});

// ✅ DO: Validate all IPC inputs in main process
ipcMain.handle('posts:create', async (_event, data: unknown) => {
  const validated = validateCreatePostInput(data);
  return postEngine.createPost(validated);
});

// ❌ DON'T: Use nodeIntegration: true
// ❌ DON'T: Expose Node.js APIs directly to renderer
```

### Window Management

```typescript
// ✅ DO: Check window existence before sending messages
if (mainWindow && !mainWindow.isDestroyed()) {
  mainWindow.webContents.send('event', data);
}

// ✅ DO: Clean up IPC handlers on window close
mainWindow.on('closed', () => {
  ipcMain.removeHandler('posts:getAll');
});
```

### Process Separation

```typescript
// Main process: File system, database, native APIs
// Renderer process: UI only, no direct fs/db access

// ✅ DO: All file operations in main process
// src/main/engine/PostEngine.ts
await fs.writeFile(filePath, content);

// ❌ DON'T: Import 'fs' in renderer
// src/renderer/components/Editor.tsx
import fs from 'fs'; // Bad!
```

## SQLite & Drizzle ORM Best Practices

### Schema Definition

```typescript
// ✅ DO: Use proper column types and constraints
export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  syncStatus: text('sync_status').$type<'pending' | 'synced'>().default('pending'),
});

// ✅ DO: Create indexes for frequently queried columns
// CREATE INDEX idx_posts_slug ON posts(slug);
// CREATE INDEX idx_posts_sync_status ON posts(sync_status);
```

### Query Patterns

```typescript
import { eq, and, desc, sql } from 'drizzle-orm';

// ✅ DO: Use Drizzle query builder
const drafts = await db
  .select()
  .from(posts)
  .where(eq(posts.status, 'draft'))
  .orderBy(desc(posts.updatedAt));

// ✅ DO: Use transactions for multi-table updates
await db.transaction(async (tx) => {
  await tx.update(posts).set({ status: 'published' }).where(eq(posts.id, id));
  await tx.insert(syncLog).values({ entityId: id, operation: 'update' });
});

// ❌ DON'T: Write raw SQL unless absolutely necessary
// ❌ DON'T: Use string interpolation in queries
const result = db.run(`SELECT * FROM posts WHERE id = '${id}'`); // SQL injection risk!
```

### Connection Management

```typescript
// ✅ DO: Use singleton pattern for database connection
let dbInstance: DatabaseConnection | null = null;

export function getDatabase(): DatabaseConnection {
  if (!dbInstance) {
    dbInstance = new DatabaseConnection();
  }
  return dbInstance;
}

// ✅ DO: Close connection gracefully on app quit
app.on('before-quit', async () => {
  await getDatabase().close();
});
```

## Remote Sync Best Practices (Dropbox)

### Sync Strategy

```typescript
// ✅ DO: Track sync status per entity
interface SyncableEntity {
  syncStatus: 'pending' | 'syncing' | 'synced' | 'conflict';
  syncedAt: number | null;
  checksum: string;
}

// ✅ DO: Use checksums to detect conflicts
const localChecksum = calculateChecksum(localContent);
const remoteChecksum = await fetchRemoteChecksum(id);
if (localChecksum !== remoteChecksum) {
  // Handle conflict
}

// ✅ DO: Implement retry logic with exponential backoff
async function syncWithRetry(maxAttempts = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sync();
      return;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}
```

### Offline-First Approach

```typescript
// ✅ DO: Always write to local first
async function savePost(post: PostData): Promise<void> {
  // 1. Save to local file system
  await writePostFile(post);
  
  // 2. Update local database
  await updateLocalDatabase(post);
  
  // 3. Mark for sync (don't wait for network)
  await markForSync(post.id);
}

// ✅ DO: Queue sync operations
const syncQueue: SyncOperation[] = [];

function queueSync(operation: SyncOperation): void {
  syncQueue.push(operation);
  processSyncQueue(); // Non-blocking
}

// ✅ DO: Handle network state changes
window.addEventListener('online', () => {
  syncEngine.processPendingChanges();
});
```

### Conflict Resolution

```typescript
// ✅ DO: Implement clear conflict resolution strategy
type ConflictResolution = 'local-wins' | 'remote-wins' | 'manual';

interface ConflictInfo {
  entityId: string;
  localVersion: EntityVersion;
  remoteVersion: EntityVersion;
  resolution?: ConflictResolution;
}

// ✅ DO: Allow user to resolve conflicts manually when needed
async function resolveConflict(
  conflict: ConflictInfo,
  resolution: ConflictResolution
): Promise<void> {
  switch (resolution) {
    case 'local-wins':
      await pushLocalToRemote(conflict.entityId);
      break;
    case 'remote-wins':
      await pullRemoteToLocal(conflict.entityId);
      break;
    case 'manual':
      await showConflictResolutionUI(conflict);
      break;
  }
}
```

### Sync Logging

```typescript
// ✅ DO: Log all sync operations for debugging
await db.insert(syncLog).values({
  id: generateId(),
  entityType: 'post',
  entityId: postId,
  operation: 'push',
  status: 'success',
  timestamp: Date.now(),
});

// ✅ DO: Implement sync status visibility in UI
const pendingCount = await syncEngine.getPendingChangesCount();
statusBar.setSyncStatus({ pending: pendingCount });
```

## React & State Management

### Zustand Patterns

```typescript
// ✅ DO: Keep store slices focused
interface AppState {
  // UI state
  activeView: 'posts' | 'media' | 'settings';
  sidebarVisible: boolean;
  
  // Data
  posts: PostData[];
  media: MediaData[];
  
  // Actions
  setActiveView: (view: AppState['activeView']) => void;
  setPosts: (posts: PostData[]) => void;
}

// ✅ DO: Use selectors for derived state
const draftCount = useAppStore((state) => 
  state.posts.filter(p => p.status === 'draft').length
);

// ❌ DON'T: Store derived data
interface BadState {
  posts: PostData[];
  draftCount: number; // Bad - derived from posts
}
```

### Component Patterns

```typescript
// ✅ DO: Use composition over prop drilling
<EditorProvider postId={selectedPostId}>
  <EditorToolbar />
  <EditorContent />
  <EditorStatusBar />
</EditorProvider>

// ✅ DO: Separate container and presentation components
// Container: handles data fetching/IPC
// Presentation: pure rendering based on props

// ❌ DON'T: Put IPC calls in deeply nested components
const DeepComponent = () => {
  // Bad - hard to test and maintain
  const handleClick = async () => {
    await window.electronAPI.posts.save(data);
  };
};
```

## File Naming Conventions

```
src/
  main/
    database/
      schema.ts        # Drizzle schema definitions
      connection.ts    # Database connection management
    engine/
      PostEngine.ts    # PascalCase for classes
      TaskManager.ts
    ipc/
      handlers.ts      # camelCase for modules
  renderer/
    components/
      Editor/
        Editor.tsx     # PascalCase for components
        Editor.css     # Matching CSS file
        index.ts       # Barrel exports
    store/
      appStore.ts      # camelCase for stores
    types/
      electron.d.ts    # Type declarations
```

## Test-Driven Development (TDD) Requirements

> **⚠️ CRITICAL: This project follows STRICT Test-Driven Development.**
>
> Writing implementation code before tests is NOT acceptable.
> Pull requests without corresponding tests will be rejected.

**All new features and bug fixes MUST have tests written BEFORE implementation.**

### The Golden Rule: Test Real Implementations

```typescript
// ✅ CORRECT: Import and test the REAL class
import { PostEngine } from '../../src/main/engine/PostEngine';

describe('PostEngine', () => {
  let postEngine: PostEngine;

  beforeEach(() => {
    // Mock only external dependencies, NOT the class under test
    postEngine = new PostEngine(mockDatabase, mockFileSystem);
  });

  it('should create a post with generated slug from title', async () => {
    const result = await postEngine.createPost({ title: 'Hello World' });
    expect(result.slug).toBe('hello-world');
  });
});

// ❌ WRONG: Testing inline helper functions instead of real implementations
describe('PostEngine', () => {
  it('should generate slug', () => {
    // This tests a local function, not the actual PostEngine class!
    const generateSlug = (title: string) => title.toLowerCase().replace(/ /g, '-');
    expect(generateSlug('Hello World')).toBe('hello-world');
  });
});
```

### TDD Workflow (Red-Green-Refactor)

```typescript
// 1. RED: Write a failing test first that uses the REAL implementation
import { PostEngine } from '../../src/main/engine/PostEngine';

describe('PostEngine.createPost', () => {
  it('should create a post with generated slug from title', async () => {
    const postEngine = new PostEngine(mockDb, mockFs);
    const result = await postEngine.createPost({ title: 'Hello World' });
    expect(result.slug).toBe('hello-world');
  });
});

// 2. GREEN: Write minimal code in PostEngine to pass the test
// 3. REFACTOR: Improve the code while keeping tests green
```

### Test File Structure

```
tests/
├── setup.ts                    # Global test configuration
├── utils/
│   ├── factories.ts           # Mock data factories
│   └── index.ts               # Utility exports
└── engine/
    ├── TaskManager.test.ts    # TaskManager unit tests
    ├── PostEngine.test.ts     # PostEngine unit tests
    ├── MediaEngine.test.ts    # MediaEngine unit tests
    └── SyncEngine.test.ts     # SyncEngine unit tests
```

### Test Naming Conventions

```typescript
// ✅ DO: Use descriptive test names that explain behavior
it('should generate slug from title with lowercase and hyphens', () => {});
it('should emit taskCompleted event when task finishes', () => {});
it('should return null when post not found', () => {});

// ❌ DON'T: Use vague test names
it('works', () => {});
it('test createPost', () => {});
```

### Mock Factory Patterns

```typescript
// ✅ DO: Use factory functions with overrides
import { createMockPost, createMockMedia } from '../utils/factories';

const post = createMockPost({ 
  title: 'Custom Title',
  status: 'published' 
});

// ✅ DO: Create specialized factories for common scenarios
const draftPost = createMockPost({ status: 'draft' });
const publishedPost = createMockPublishedPost();
const imageMedia = createMockMedia({ mimeType: 'image/jpeg' });
const pdfMedia = createMockPdfMedia();
```

### Testing Async Code

```typescript
// ✅ DO: Use async/await in tests
it('should save post to filesystem', async () => {
  const post = createMockPost();
  await postEngine.createPost(post);
  
  expect(fs.writeFile).toHaveBeenCalled();
});

// ✅ DO: Test event emissions
it('should emit postCreated event', async () => {
  const handler = vi.fn();
  postEngine.on('postCreated', handler);
  
  await postEngine.createPost({ title: 'Test' });
  
  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Test' })
  );
});

// ✅ DO: Test error cases
it('should throw when file write fails', async () => {
  vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error('ENOSPC'));
  
  await expect(postEngine.createPost({ title: 'Test' }))
    .rejects.toThrow('ENOSPC');
});
```

### Mocking Dependencies

```typescript
// ✅ DO: Mock at module level for consistent behavior
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => mockDatabase),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

// ✅ DO: Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

### Test Coverage Requirements

- **Minimum coverage**: 80% for engine classes
- **Critical paths**: 100% coverage for data mutations
- **Edge cases**: Null handling, empty arrays, error conditions

```bash
# Run tests with coverage
npm run test:coverage

# View coverage report
open coverage/index.html
```

### When to Write Tests

| Scenario | Test Requirement |
|----------|-----------------|
| New engine method | Unit tests BEFORE implementation |
| Bug fix | Failing test that reproduces bug FIRST |
| Refactoring | Ensure existing tests pass BEFORE and AFTER |
| IPC handler | Integration test with mocked engine |
| UI component | Behavior tests for user interactions |

### Test Commands

```bash
npm run test           # Run all tests once
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Generate coverage report
npm run test:ui        # Open Vitest UI
```

### Vitest Configuration

Tests are configured in `vitest.config.ts` with:
- Global test utilities (describe, it, expect, vi)
- Node environment for main process tests
- Coverage reports via v8
- Custom setup file for Electron mocks

## Testing Considerations

```typescript
// ✅ DO: Design for testability
// - Engine classes should accept dependencies via constructor
// - Use interfaces for external dependencies
// - Keep pure business logic separate from I/O

class PostEngine {
  constructor(
    private db: DatabaseConnection,
    private fs: FileSystemAdapter, // Mockable
    private eventEmitter: EventEmitter
  ) {}
}

// ✅ DO: Use factory functions for test data
function createTestPost(overrides?: Partial<PostData>): PostData {
  return {
    id: 'test-id',
    title: 'Test Post',
    status: 'draft',
    ...overrides,
  };
}

// ✅ DO: Test pure functions in isolation
describe('generateSlug', () => {
  it('should convert to lowercase', () => {
    expect(generateSlug('Hello World')).toBe('hello-world');
  });
  
  it('should replace special characters', () => {
    expect(generateSlug('Hello, World!')).toBe('hello-world');
  });
});
```

## Common Patterns in This Codebase

### Creating a New Engine Method

```typescript
// 1. Add method to engine class
async newOperation(input: InputType): Promise<OutputType> {
  // Validate input
  // Perform operation
  // Emit event for UI updates
  this.emit('operationCompleted', result);
  return result;
}

// 2. Add IPC handler
ipcMain.handle('entity:operation', async (_event, input) => {
  return engine.newOperation(input);
});

// 3. Expose in preload
entity: {
  operation: (input) => ipcRenderer.invoke('entity:operation', input),
}

// 4. Update store and UI
```

### Adding a New Database Table

```typescript
// 1. Define in schema.ts with proper types
export const newTable = sqliteTable('new_table', {
  id: text('id').primaryKey(),
  // ... columns
});

// 2. Export types
export type NewTableRow = typeof newTable.$inferSelect;
export type NewTableInsert = typeof newTable.$inferInsert;

// 3. Add CREATE TABLE to migrations in connection.ts
// 4. Create corresponding engine class
```

## Security Reminders

- Never log sensitive data (auth tokens, passwords)
- Validate all IPC inputs before processing
- Use `contextIsolation: true` and `sandbox: false` only when necessary
- Store Dropbox auth tokens in secure storage, not in code
- Sanitize user input before rendering (XSS prevention)
