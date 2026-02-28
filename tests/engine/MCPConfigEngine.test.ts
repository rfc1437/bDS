import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPAgentConfigEngine } from '../../src/main/engine/MCPAgentConfigEngine';
import { stringify as stringifyToml, parse as parseToml } from 'smol-toml';

// Mock fs
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
      writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
      existsSync: (...args: unknown[]) => mockExistsSync(...args),
      mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    },
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  };
});

const EXEC = '/path/to/electron';
const SCRIPT = '/path/to/bds-mcp.cjs';

const stdioEntry = {
  command: EXEC,
  args: [SCRIPT],
  env: { ELECTRON_RUN_AS_NODE: '1' },
};

/** Helper to parse the JSON written in the first writeFileSync call. */
function writtenJson(): Record<string, unknown> {
  return JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
}

/** Helper to parse the TOML written in the first writeFileSync call. */
function writtenToml(): Record<string, unknown> {
  const raw = (mockWriteFileSync.mock.calls[0]![1] as string).trim();
  return parseToml(raw) as Record<string, unknown>;
}

describe('MCPAgentConfigEngine', () => {
  let engine: MCPAgentConfigEngine;

  beforeEach(() => {
    vi.resetAllMocks();
    engine = new MCPAgentConfigEngine({
      homeDir: '/home/testuser',
      platform: 'darwin',
      execPath: EXEC,
      scriptPath: SCRIPT,
    });
  });

  // ── getAgents ────────────────────────────────────────────────────

  describe('getAgents', () => {
    it('returns all 7 supported agent definitions', () => {
      const agents = engine.getAgents();
      expect(agents).toHaveLength(7);
      const ids = agents.map((a) => a.id);
      expect(ids).toContain('claude-code');
      expect(ids).toContain('claude-desktop');
      expect(ids).toContain('github-copilot');
      expect(ids).toContain('gemini-cli');
      expect(ids).toContain('opencode');
      expect(ids).toContain('mistral-vibe');
      expect(ids).toContain('openai-codex');
    });

    it('includes display labels for each agent', () => {
      for (const agent of engine.getAgents()) {
        expect(agent.label).toBeTruthy();
        expect(typeof agent.label).toBe('string');
      }
    });
  });

  // ── getConfigPath ────────────────────────────────────────────────

  describe('getConfigPath', () => {
    it('returns ~/.claude.json for claude-code', () => {
      expect(engine.getConfigPath('claude-code')).toBe('/home/testuser/.claude.json');
    });

    it('returns macOS VS Code user mcp.json for github-copilot on darwin', () => {
      expect(engine.getConfigPath('github-copilot')).toBe(
        '/home/testuser/Library/Application Support/Code/User/mcp.json',
      );
    });

    it('returns Linux VS Code user mcp.json for github-copilot on linux', () => {
      const linuxEngine = new MCPAgentConfigEngine({
        homeDir: '/home/user',
        platform: 'linux',
        execPath: EXEC,
        scriptPath: SCRIPT,
      });
      expect(linuxEngine.getConfigPath('github-copilot')).toBe(
        '/home/user/.config/Code/User/mcp.json',
      );
    });

    it('returns ~/.gemini/settings.json for gemini-cli', () => {
      expect(engine.getConfigPath('gemini-cli')).toBe('/home/testuser/.gemini/settings.json');
    });

    it('returns ~/.opencode.json for opencode', () => {
      expect(engine.getConfigPath('opencode')).toBe('/home/testuser/.opencode.json');
    });

    it('returns ~/.vibe/config.toml for mistral-vibe', () => {
      expect(engine.getConfigPath('mistral-vibe')).toBe('/home/testuser/.vibe/config.toml');
    });

    it('returns ~/.codex/config.toml for openai-codex', () => {
      expect(engine.getConfigPath('openai-codex')).toBe('/home/testuser/.codex/config.toml');
    });
  });

  // ── addToConfig (claude-code) ────────────────────────────────────

  describe('addToConfig (claude-code)', () => {
    it('creates new config with stdio entry when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.addToConfig('claude-code');

      expect(result.success).toBe(true);
      expect(result.configPath).toBe('/home/testuser/.claude.json');
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      expect(writtenJson().mcpServers).toEqual({ bDS: stdioEntry });
    });

    it('merges into existing config without overwriting other servers', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: { other: { type: 'stdio', command: 'npx' } },
          someOtherKey: 'keep',
        }),
      );

      const result = engine.addToConfig('claude-code');

      expect(result.success).toBe(true);
      const w = writtenJson();
      expect((w.mcpServers as Record<string, unknown>)['other']).toEqual({ type: 'stdio', command: 'npx' });
      expect((w.mcpServers as Record<string, unknown>)['bDS']).toEqual(stdioEntry);
      expect(w.someOtherKey).toBe('keep');
    });

    it('overwrites existing bDS entry to update paths', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: { bDS: { command: '/old/exec', args: ['/old/script'] } },
        }),
      );

      const result = engine.addToConfig('claude-code');

      expect(result.success).toBe(true);
      const bds = (writtenJson().mcpServers as Record<string, unknown>)['bDS'] as Record<string, unknown>;
      expect(bds.command).toBe(EXEC);
    });
  });

  // ── addToConfig (github-copilot) ─────────────────────────────────

  describe('addToConfig (github-copilot)', () => {
    it('creates new mcp.json with servers key and type: stdio', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.addToConfig('github-copilot');

      expect(result.success).toBe(true);
      const w = writtenJson();
      expect((w.servers as Record<string, unknown>)['bDS']).toEqual({ type: 'stdio', ...stdioEntry });
      expect(w.mcpServers).toBeUndefined();
    });

    it('creates parent directory if needed', () => {
      mockExistsSync.mockReturnValue(false);

      engine.addToConfig('github-copilot');

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('Code/User'),
        { recursive: true },
      );
    });

    it('merges into existing VS Code config preserving other servers', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          servers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp' } },
        }),
      );

      const result = engine.addToConfig('github-copilot');

      expect(result.success).toBe(true);
      const servers = writtenJson().servers as Record<string, Record<string, unknown>>;
      expect(servers.github.url).toBe('https://api.githubcopilot.com/mcp');
      expect(servers.bDS).toEqual({ type: 'stdio', ...stdioEntry });
    });
  });

  // ── addToConfig (gemini-cli) ──────────────────────────────────────

  describe('addToConfig (gemini-cli)', () => {
    it('creates new settings.json with stdio entry', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.addToConfig('gemini-cli');

      expect(result.success).toBe(true);
      expect((writtenJson().mcpServers as Record<string, unknown>)['bDS']).toEqual(stdioEntry);
    });

    it('creates ~/.gemini directory if needed', () => {
      mockExistsSync.mockReturnValue(false);

      engine.addToConfig('gemini-cli');

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.gemini'),
        { recursive: true },
      );
    });

    it('preserves existing settings when adding MCP server', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          theme: 'dark',
          mcpServers: { existing: { command: 'python' } },
        }),
      );

      const result = engine.addToConfig('gemini-cli');

      expect(result.success).toBe(true);
      const w = writtenJson();
      expect(w.theme).toBe('dark');
      const servers = w.mcpServers as Record<string, Record<string, unknown>>;
      expect(servers.existing).toEqual({ command: 'python' });
      expect(servers.bDS).toEqual(stdioEntry);
    });
  });

  // ── addToConfig (opencode) ────────────────────────────────────────

  describe('addToConfig (opencode)', () => {
    it('creates new .opencode.json with type: stdio', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.addToConfig('opencode');

      expect(result.success).toBe(true);
      expect((writtenJson().mcpServers as Record<string, unknown>)['bDS']).toEqual({
        type: 'stdio',
        ...stdioEntry,
      });
    });

    it('merges into existing opencode config', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          providers: { openai: { apiKey: 'key' } },
          mcpServers: { debugger: { type: 'stdio', command: 'debug' } },
        }),
      );

      const result = engine.addToConfig('opencode');

      expect(result.success).toBe(true);
      const w = writtenJson();
      expect((w.providers as Record<string, Record<string, string>>).openai.apiKey).toBe('key');
      const servers = w.mcpServers as Record<string, Record<string, unknown>>;
      expect(servers.debugger.command).toBe('debug');
      expect(servers.bDS.type).toBe('stdio');
      expect(servers.bDS.command).toBe(EXEC);
    });
  });

  // ── addToConfig (claude-desktop) ──────────────────────────────────

  describe('addToConfig (claude-desktop)', () => {
    it('returns correct config path on macOS', () => {
      expect(engine.getConfigPath('claude-desktop')).toBe(
        '/home/testuser/Library/Application Support/Claude/claude_desktop_config.json',
      );
    });

    it('returns correct config path on Windows', () => {
      const winEngine = new MCPAgentConfigEngine({
        homeDir: 'C:\\Users\\testuser',
        platform: 'win32',
        execPath: 'C:\\path\\to\\app.exe',
        scriptPath: 'C:\\path\\to\\bds-mcp.cjs',
      });
      const normalised = winEngine.getConfigPath('claude-desktop').replace(/[\\/]/g, '/');
      expect(normalised).toBe(
        'C:/Users/testuser/AppData/Roaming/Claude/claude_desktop_config.json',
      );
    });

    it('returns correct config path on Linux', () => {
      const linuxEngine = new MCPAgentConfigEngine({
        homeDir: '/home/user',
        platform: 'linux',
        execPath: EXEC,
        scriptPath: SCRIPT,
      });
      expect(linuxEngine.getConfigPath('claude-desktop')).toBe(
        '/home/user/.config/Claude/claude_desktop_config.json',
      );
    });

    it('adds stdio entry with command/args/env', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.addToConfig('claude-desktop');

      expect(result.success).toBe(true);
      expect((writtenJson().mcpServers as Record<string, unknown>)['bDS']).toEqual(stdioEntry);
    });
  });

  // ── addToConfig (mistral-vibe) ────────────────────────────────────

  describe('addToConfig (mistral-vibe)', () => {
    it('creates new config.toml with bDS entry', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.addToConfig('mistral-vibe');

      expect(result.success).toBe(true);
      expect(result.configPath).toBe('/home/testuser/.vibe/config.toml');
      const t = writtenToml();
      const servers = t.mcp_servers as Record<string, unknown>[];
      expect(servers).toHaveLength(1);
      expect(servers[0]).toEqual({
        name: 'bDS',
        transport: 'stdio',
        command: EXEC,
        args: [SCRIPT],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      });
    });

    it('preserves other servers when adding bDS', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: [
            { name: 'other', transport: 'stdio', command: 'npx', args: ['something'] },
          ],
        }),
      );

      const result = engine.addToConfig('mistral-vibe');

      expect(result.success).toBe(true);
      const servers = writtenToml().mcp_servers as Record<string, unknown>[];
      expect(servers).toHaveLength(2);
      expect(servers.find((s) => s.name === 'other')).toBeDefined();
      expect(servers.find((s) => s.name === 'bDS')).toBeDefined();
    });

    it('replaces existing bDS entry', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: [
            { name: 'bDS', transport: 'stdio', command: '/old/exec', args: ['/old/script'] },
          ],
        }),
      );

      const result = engine.addToConfig('mistral-vibe');

      expect(result.success).toBe(true);
      const servers = writtenToml().mcp_servers as Record<string, unknown>[];
      expect(servers).toHaveLength(1);
      expect((servers[0] as Record<string, unknown>).command).toBe(EXEC);
    });

    it('creates ~/.vibe directory if needed', () => {
      mockExistsSync.mockReturnValue(false);

      engine.addToConfig('mistral-vibe');

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.vibe'),
        { recursive: true },
      );
    });
  });

  // ── addToConfig (openai-codex) ────────────────────────────────────

  describe('addToConfig (openai-codex)', () => {
    it('creates new config.toml with bDS entry', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.addToConfig('openai-codex');

      expect(result.success).toBe(true);
      expect(result.configPath).toBe('/home/testuser/.codex/config.toml');
      const t = writtenToml();
      const servers = t.mcp_servers as Record<string, Record<string, unknown>>;
      expect(servers.bDS).toEqual({
        command: EXEC,
        args: [SCRIPT],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      });
    });

    it('preserves other servers when adding bDS', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: {
            other: { command: 'npx', args: ['something'] },
          },
        }),
      );

      const result = engine.addToConfig('openai-codex');

      expect(result.success).toBe(true);
      const servers = writtenToml().mcp_servers as Record<string, Record<string, unknown>>;
      expect(servers.other).toBeDefined();
      expect(servers.bDS).toBeDefined();
    });

    it('replaces existing bDS entry', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: {
            bDS: { command: '/old/exec', args: ['/old/script'] },
          },
        }),
      );

      const result = engine.addToConfig('openai-codex');

      expect(result.success).toBe(true);
      const servers = writtenToml().mcp_servers as Record<string, Record<string, unknown>>;
      expect(servers.bDS.command).toBe(EXEC);
    });

    it('creates ~/.codex directory if needed', () => {
      mockExistsSync.mockReturnValue(false);

      engine.addToConfig('openai-codex');

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.codex'),
        { recursive: true },
      );
    });
  });

  // ── error handling ────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns error result when read fails', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = engine.addToConfig('claude-code');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('returns error result when write fails', () => {
      mockExistsSync.mockReturnValue(false);
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('Disk full');
      });

      const result = engine.addToConfig('claude-code');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Disk full');
    });

    it('returns error for invalid existing JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not valid json{{{');

      const result = engine.addToConfig('claude-code');

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('returns error for invalid existing TOML', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('[[[ invalid toml');

      const result = engine.addToConfig('mistral-vibe');

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ── isConfigured ──────────────────────────────────────────────────

  describe('isConfigured', () => {
    it('returns true when bDS entry exists in JSON config', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ mcpServers: { bDS: { command: EXEC } } }),
      );

      expect(engine.isConfigured('claude-code')).toBe(true);
    });

    it('returns false when config file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(engine.isConfigured('claude-code')).toBe(false);
    });

    it('returns false when bDS entry is missing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ mcpServers: { other: {} } }),
      );

      expect(engine.isConfigured('claude-code')).toBe(false);
    });

    it('checks VS Code servers key for github-copilot', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ servers: { bDS: { type: 'stdio', command: EXEC } } }),
      );

      expect(engine.isConfigured('github-copilot')).toBe(true);
    });

    it('returns true for mistral-vibe when bDS entry exists in TOML array', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: [{ name: 'bDS', transport: 'stdio', command: EXEC }],
        }),
      );

      expect(engine.isConfigured('mistral-vibe')).toBe(true);
    });

    it('returns false for mistral-vibe when bDS is absent', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: [{ name: 'other', transport: 'stdio', command: 'npx' }],
        }),
      );

      expect(engine.isConfigured('mistral-vibe')).toBe(false);
    });

    it('returns true for openai-codex when bDS entry exists in TOML table', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: { bDS: { command: EXEC } },
        }),
      );

      expect(engine.isConfigured('openai-codex')).toBe(true);
    });

    it('returns false for openai-codex when bDS is absent', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: { other: { command: 'npx' } },
        }),
      );

      expect(engine.isConfigured('openai-codex')).toBe(false);
    });
  });

  // ── stdio paths ───────────────────────────────────────────────────

  describe('stdio paths', () => {
    it('uses the provided execPath and scriptPath in all entries', () => {
      const customEngine = new MCPAgentConfigEngine({
        homeDir: '/tmp',
        platform: 'darwin',
        execPath: '/custom/electron',
        scriptPath: '/custom/bds-mcp.cjs',
      });
      mockExistsSync.mockReturnValue(false);

      customEngine.addToConfig('claude-code');

      const bds = (writtenJson().mcpServers as Record<string, Record<string, unknown>>).bDS;
      expect(bds.command).toBe('/custom/electron');
      expect(bds.args).toEqual(['/custom/bds-mcp.cjs']);
      expect(bds.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    });
  });

  // ── removeFromConfig ──────────────────────────────────────────────

  describe('removeFromConfig', () => {
    it('removes bDS entry from JSON config and returns success', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            bDS: stdioEntry,
            other: { command: 'npx' },
          },
        }),
      );

      const result = engine.removeFromConfig('claude-code');

      expect(result.success).toBe(true);
      const w = writtenJson();
      expect((w.mcpServers as Record<string, unknown>)['bDS']).toBeUndefined();
      expect((w.mcpServers as Record<string, unknown>)['other']).toBeDefined();
    });

    it('removes the mcpServers key entirely when bDS was the only entry', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ mcpServers: { bDS: stdioEntry } }),
      );

      engine.removeFromConfig('claude-code');

      expect(writtenJson().mcpServers).toBeUndefined();
    });

    it('no-ops gracefully when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.removeFromConfig('claude-code');

      expect(result.success).toBe(true);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('no-ops gracefully when bDS entry is not in config', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ mcpServers: { other: {} } }));

      const result = engine.removeFromConfig('claude-code');

      expect(result.success).toBe(true);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('uses the servers key for github-copilot', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ servers: { bDS: { type: 'stdio', ...stdioEntry } } }),
      );

      const result = engine.removeFromConfig('github-copilot');

      expect(result.success).toBe(true);
      expect(writtenJson().servers).toBeUndefined();
    });

    it('returns success with configPath', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.removeFromConfig('claude-code');

      expect(result.success).toBe(true);
      expect(result.configPath).toBe('/home/testuser/.claude.json');
    });

    it('removes bDS from mistral-vibe TOML array', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: [
            { name: 'bDS', transport: 'stdio', command: EXEC, args: [SCRIPT] },
            { name: 'other', transport: 'stdio', command: 'npx', args: ['x'] },
          ],
        }),
      );

      const result = engine.removeFromConfig('mistral-vibe');

      expect(result.success).toBe(true);
      const servers = writtenToml().mcp_servers as Record<string, unknown>[];
      expect(servers).toHaveLength(1);
      expect((servers[0] as Record<string, unknown>).name).toBe('other');
    });

    it('removes mcp_servers key from vibe when bDS was the only entry', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: [{ name: 'bDS', transport: 'stdio', command: EXEC, args: [SCRIPT] }],
        }),
      );

      engine.removeFromConfig('mistral-vibe');

      expect(writtenToml().mcp_servers).toBeUndefined();
    });

    it('no-ops when mistral-vibe config does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.removeFromConfig('mistral-vibe');

      expect(result.success).toBe(true);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('removes bDS from openai-codex TOML table', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: {
            bDS: { command: EXEC, args: [SCRIPT] },
            other: { command: 'npx', args: ['x'] },
          },
        }),
      );

      const result = engine.removeFromConfig('openai-codex');

      expect(result.success).toBe(true);
      const servers = writtenToml().mcp_servers as Record<string, Record<string, unknown>>;
      expect(servers.bDS).toBeUndefined();
      expect(servers.other).toBeDefined();
    });

    it('removes mcp_servers key from codex when bDS was the only entry', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        stringifyToml({
          mcp_servers: { bDS: { command: EXEC, args: [SCRIPT] } },
        }),
      );

      engine.removeFromConfig('openai-codex');

      expect(writtenToml().mcp_servers).toBeUndefined();
    });

    it('no-ops when openai-codex config does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.removeFromConfig('openai-codex');

      expect(result.success).toBe(true);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });
});
