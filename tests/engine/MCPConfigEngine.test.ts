import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPAgentConfigEngine, type MCPAgentId, type AgentConfigResult } from '../../src/main/engine/MCPAgentConfigEngine';

// Mock fs and os
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

describe('MCPAgentConfigEngine', () => {
  let engine: MCPAgentConfigEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new MCPAgentConfigEngine({
      homeDir: '/home/testuser',
      platform: 'darwin',
      mcpUrl: 'http://127.0.0.1:4124/mcp',
    });
  });

  describe('getAgents', () => {
    it('returns all supported agent definitions', () => {
      const agents = engine.getAgents();
      expect(agents).toHaveLength(4);
      const ids = agents.map((a) => a.id);
      expect(ids).toContain('claude-code');
      expect(ids).toContain('github-copilot');
      expect(ids).toContain('gemini-cli');
      expect(ids).toContain('opencode');
    });

    it('includes display labels for each agent', () => {
      const agents = engine.getAgents();
      for (const agent of agents) {
        expect(agent.label).toBeTruthy();
        expect(typeof agent.label).toBe('string');
      }
    });
  });

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
        mcpUrl: 'http://127.0.0.1:4124/mcp',
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
  });

  describe('addToConfig (claude-code)', () => {
    it('creates new config when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.addToConfig('claude-code');

      expect(result.success).toBe(true);
      expect(result.configPath).toBe('/home/testuser/.claude.json');
      expect(mockWriteFileSync).toHaveBeenCalledOnce();

      const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
      expect(written.mcpServers.bDS).toEqual({ type: 'http', url: 'http://127.0.0.1:4124/mcp' });
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
      const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
      expect(written.mcpServers.other).toEqual({ type: 'stdio', command: 'npx' });
      expect(written.mcpServers.bDS).toEqual({ type: 'http', url: 'http://127.0.0.1:4124/mcp' });
      expect(written.someOtherKey).toBe('keep');
    });

    it('overwrites existing bDS entry to update URL', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: { bDS: { type: 'http', url: 'http://old:1234/mcp' } },
        }),
      );

      const result = engine.addToConfig('claude-code');

      expect(result.success).toBe(true);
      const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
      expect(written.mcpServers.bDS.url).toBe('http://127.0.0.1:4124/mcp');
    });
  });

  describe('addToConfig (github-copilot)', () => {
    it('creates new .vscode/mcp.json with correct servers key', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.addToConfig('github-copilot');

      expect(result.success).toBe(true);
      const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
      expect(written.servers.bDS).toEqual({ type: 'http', url: 'http://127.0.0.1:4124/mcp' });
      // Should NOT have mcpServers key
      expect(written.mcpServers).toBeUndefined();
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
      const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
      expect(written.servers.github.url).toBe('https://api.githubcopilot.com/mcp');
      expect(written.servers.bDS.url).toBe('http://127.0.0.1:4124/mcp');
    });
  });

  describe('addToConfig (gemini-cli)', () => {
    it('creates new settings.json with httpUrl entry', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.addToConfig('gemini-cli');

      expect(result.success).toBe(true);
      const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
      expect(written.mcpServers.bDS).toEqual({ httpUrl: 'http://127.0.0.1:4124/mcp' });
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
      const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
      expect(written.theme).toBe('dark');
      expect(written.mcpServers.existing).toEqual({ command: 'python' });
      expect(written.mcpServers.bDS).toEqual({ httpUrl: 'http://127.0.0.1:4124/mcp' });
    });
  });

  describe('addToConfig (opencode)', () => {
    it('creates new .opencode.json with sse type', () => {
      mockExistsSync.mockReturnValue(false);

      const result = engine.addToConfig('opencode');

      expect(result.success).toBe(true);
      const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
      expect(written.mcpServers.bDS).toEqual({ type: 'sse', url: 'http://127.0.0.1:4124/mcp' });
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
      const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
      expect(written.providers.openai.apiKey).toBe('key');
      expect(written.mcpServers.debugger.command).toBe('debug');
      expect(written.mcpServers.bDS.type).toBe('sse');
    });
  });

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
  });

  describe('isConfigured', () => {
    it('returns true when bDS entry exists in config', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: { bDS: { type: 'http', url: 'http://127.0.0.1:4124/mcp' } },
        }),
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
        JSON.stringify({ servers: { bDS: { type: 'http', url: 'x' } } }),
      );

      expect(engine.isConfigured('github-copilot')).toBe(true);
    });
  });

  describe('dynamic port', () => {
    it('uses the provided mcpUrl in server entries', () => {
      const customEngine = new MCPAgentConfigEngine({
        homeDir: '/tmp',
        platform: 'darwin',
        mcpUrl: 'http://127.0.0.1:9999/mcp',
      });
      mockExistsSync.mockReturnValue(false);

      customEngine.addToConfig('claude-code');

      const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
      expect(written.mcpServers.bDS.url).toBe('http://127.0.0.1:9999/mcp');
    });
  });
});
