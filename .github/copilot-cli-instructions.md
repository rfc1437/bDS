# GitHub Copilot CLI Instructions for bDS

Quick reference for using GitHub Copilot CLI (`gh copilot`) with this Electron + TypeScript + SQLite project.

## Project Context for CLI Queries

When asking Copilot CLI for help, provide this context for better responses:

```
This is an Electron app using TypeScript, React, Drizzle ORM, and @libsql/client for SQLite.
```

---

## Common CLI Patterns

### Build & Development

```bash
# Ask how to run in development
gh copilot suggest "how to run electron app in dev mode with vite HMR"

# Ask about TypeScript compilation
gh copilot suggest "compile typescript for electron main process with tsconfig"

# Build commands for this project
npm run build:main    # TypeScript -> JavaScript for main process
npm run build:renderer # Vite build for React renderer
npm run build         # Both
npm start            # Launch Electron
```

### Database Operations

```bash
# Generate Drizzle migrations
gh copilot suggest "generate drizzle orm migration for sqlite"

# Query patterns
gh copilot suggest "drizzle orm query to select with where clause typescript"

# Turso sync
gh copilot suggest "sync local sqlite with turso remote database libsql"
```

### Electron Commands

```bash
# IPC patterns
gh copilot suggest "electron ipc invoke handler with typescript types"

# Window management
gh copilot suggest "electron create browser window with preload script"

# Menu creation
gh copilot suggest "electron application menu with keyboard shortcuts"
```

---

## TypeScript Quick Fixes

### Type Errors

```bash
# When you see "Type X is not assignable to type Y"
gh copilot explain "typescript error Type X is not assignable to type Y"

# For generic type issues
gh copilot suggest "typescript generic function that returns same type as input"

# Promise/async issues
gh copilot suggest "typescript async function return type Promise"
```

### Common Patterns

```bash
# Discriminated unions
gh copilot suggest "typescript discriminated union for status types"

# Type guards
gh copilot suggest "typescript type guard function to narrow union type"

# Utility types
gh copilot suggest "typescript Pick Omit Partial for interface modification"
```

---

## SQLite & Drizzle Queries

### Schema Definition

```bash
# Create new table
gh copilot suggest "drizzle orm sqlite table schema with text integer columns"

# Add index
gh copilot suggest "drizzle orm create index on sqlite table"

# Relations
gh copilot suggest "drizzle orm one to many relation sqlite"
```

### Query Building

```bash
# Select with conditions
gh copilot suggest "drizzle orm select where equals and order by"

# Insert with returning
gh copilot suggest "drizzle orm insert returning inserted row"

# Update with conditions
gh copilot suggest "drizzle orm update set where condition"

# Transaction
gh copilot suggest "drizzle orm transaction with multiple operations"
```

### LibSQL Specifics

```bash
# Local file database
gh copilot suggest "libsql client connect to local sqlite file"

# Remote Turso connection
gh copilot suggest "libsql client connect turso with auth token"

# Execute multiple statements
gh copilot suggest "libsql execute multiple sql statements batch"
```

---

## Sync Implementation

### Conflict Detection

```bash
gh copilot suggest "detect sync conflicts using checksums typescript"
gh copilot suggest "last-write-wins conflict resolution pattern"
gh copilot suggest "vector clock for distributed sync"
```

### Offline Queue

```bash
gh copilot suggest "queue offline operations for later sync typescript"
gh copilot suggest "exponential backoff retry logic async"
gh copilot suggest "detect online offline status in electron"
```

### Sync Status

```bash
gh copilot suggest "track sync status pending synced error per record"
gh copilot suggest "sync log table for audit trail"
```

---

## React & Zustand

### Store Patterns

```bash
gh copilot suggest "zustand store with typescript typed actions"
gh copilot suggest "zustand selector to prevent unnecessary rerenders"
gh copilot suggest "zustand persist middleware for local storage"
```

### Component Patterns

```bash
gh copilot suggest "react component with zustand store hook"
gh copilot suggest "react useEffect cleanup for ipc listener"
gh copilot suggest "react context provider with typescript"
```

---

## Electron Security

```bash
# Secure IPC
gh copilot suggest "electron context bridge expose api safely"

# Input validation
gh copilot suggest "validate ipc handler input zod typescript"

# Content Security Policy
gh copilot suggest "electron content security policy meta tag"
```

---

## File Operations

### Markdown with Frontmatter

```bash
gh copilot suggest "read markdown file with yaml frontmatter gray-matter"
gh copilot suggest "write markdown file with yaml frontmatter node"
gh copilot suggest "parse yaml frontmatter to typescript type"
```

### Media Files

```bash
gh copilot suggest "copy file to destination directory nodejs"
gh copilot suggest "get image dimensions from file nodejs"
gh copilot suggest "calculate file checksum md5 nodejs"
```

### Sidecar Pattern

```bash
gh copilot suggest "json sidecar metadata file for binary asset"
gh copilot suggest "read write json file atomic operation"
```

---

## Error Handling

```bash
# Custom errors
gh copilot suggest "typescript custom error class with error code"

# Result types
gh copilot suggest "typescript result type success or error pattern"

# Async error handling
gh copilot suggest "try catch async await with typed error"
```

---

## Test-Driven Development (TDD)

**This project requires TDD. Write tests BEFORE implementation.**

### TDD Workflow

```bash
# Step 1: Write failing test first
gh copilot suggest "vitest test for function that does X should return Y"

# Step 2: Make test pass with minimal code
gh copilot suggest "minimal implementation to make vitest test pass"

# Step 3: Refactor while keeping tests green
gh copilot suggest "refactor function for readability typescript"
```

### Test Commands

```bash
npm run test           # Run all tests once
npm run test:watch     # Watch mode (re-run on changes)
npm run test:coverage  # Generate coverage report
npm run test:ui        # Open Vitest UI in browser
```

### Writing Tests

```bash
# Create unit test
gh copilot suggest "vitest unit test for typescript async function"

# Test with mocks
gh copilot suggest "vitest mock module fs promises typescript"

# Test event emitters
gh copilot suggest "vitest test eventemitter emit and listen"

# Test error cases
gh copilot suggest "vitest test async function throws error"
```

### Mock Patterns

```bash
# Mock database
gh copilot suggest "vitest mock drizzle orm database connection"

# Mock file system
gh copilot suggest "vitest mock fs promises readFile writeFile"

# Mock Electron
gh copilot suggest "vitest mock electron app ipcMain"

# Factory functions
gh copilot suggest "typescript factory function create test data with overrides"
```

### Coverage

```bash
# Check coverage
gh copilot suggest "vitest coverage v8 configuration"

# Coverage thresholds
gh copilot suggest "vitest minimum coverage threshold configuration"
```

### Testing Specific Scenarios

```bash
# Task management tests
gh copilot suggest "vitest test async task queue with progress callback"

# Sync engine tests
gh copilot suggest "vitest test sync conflict detection by checksum"

# Post engine tests
gh copilot suggest "vitest test markdown frontmatter parse and serialize"

# Media tests
gh copilot suggest "vitest test file checksum calculation md5"
```

---

## Git Operations

```bash
# Commits
gh copilot suggest "git commit message for feature typescript"

# Branching
gh copilot suggest "git branch naming convention feature bugfix"

# Stashing
gh copilot suggest "git stash changes and apply later"
```

---

## Project-Specific Commands

### Quick Reference

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Dev mode | `npm run dev` (runs Vite + TSC watch) |
| Build all | `npm run build` |
| Start app | `npm start` |
| Run tests | `npm run test` |
| Watch tests | `npm run test:watch` |
| Coverage | `npm run test:coverage` |
| Build main only | `npm run build:main` |
| Build renderer only | `npm run build:renderer` |

### File Locations

| What | Where |
|------|-------|
| Electron main | `src/main/` |
| React renderer | `src/renderer/` |
| Database schema | `src/main/database/schema.ts` |
| Engine classes | `src/main/engine/` |
| IPC handlers | `src/main/ipc/handlers.ts` |
| React components | `src/renderer/components/` |
| State store | `src/renderer/store/appStore.ts` |

### Adding a Feature Checklist

```bash
# 1. Schema (if new data)
gh copilot suggest "add column to drizzle sqlite table"

# 2. Engine method
gh copilot suggest "engine class method with event emitter typescript"

# 3. IPC handler
gh copilot suggest "electron ipc handle invoke pattern"

# 4. Preload exposure
gh copilot suggest "electron preload contextBridge expose"

# 5. Store action
gh copilot suggest "zustand action to update state"

# 6. UI component
gh copilot suggest "react component call electron api"
```

---

## Troubleshooting

### Common Issues

```bash
# Module not found
gh copilot explain "cannot find module typescript error electron"

# IPC not working
gh copilot explain "electron ipc invoke not receiving response"

# Database locked
gh copilot explain "sqlite database is locked error"

# Build fails
gh copilot explain "vite build error cannot resolve module"
```

### Debugging

```bash
# Enable source maps
gh copilot suggest "typescript source maps for electron debugging"

# DevTools
gh copilot suggest "open chrome devtools in electron app"

# Logging
gh copilot suggest "electron log to file in main process"
```

---

## Best Practices Summary

When asking Copilot CLI for code in this project:

1. **Specify TypeScript** - Always mention "typescript" for typed responses
2. **Mention Electron context** - "main process" or "renderer process"
3. **Reference Drizzle** - Use "drizzle orm" not "raw sql"
4. **Async patterns** - Request "async/await" not callbacks
5. **Type safety** - Ask for "typed" or "with types" versions

Example well-formed query:
```bash
gh copilot suggest "typescript async function to update drizzle orm record with transaction in electron main process"
```
