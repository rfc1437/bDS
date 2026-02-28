/**
 * MCPAgentConfigEngine – adds the bDS MCP server entry to coding-agent config files.
 *
 * Supports: Claude Code, GitHub Copilot (VS Code), Gemini CLI, OpenCode.
 * Each agent has its own config file format; this engine reads, merges, and writes
 * the appropriate JSON structure without overwriting existing entries.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

// ── Public types ─────────────────────────────────────────────────────

export type MCPAgentId = 'claude-code' | 'claude-desktop' | 'github-copilot' | 'gemini-cli' | 'opencode';

export interface AgentDefinition {
  id: MCPAgentId;
  label: string;
}

export interface AgentConfigResult {
  success: boolean;
  configPath: string;
  error?: string;
}

export interface MCPAgentConfigOptions {
  homeDir: string;
  platform: NodeJS.Platform;
  mcpUrl: string;
  /** Required when agentId is 'claude-desktop'; unused otherwise. */
  execPath?: string;
  /** Required when agentId is 'claude-desktop'; unused otherwise. */
  scriptPath?: string;
}

// ── Agent definitions ────────────────────────────────────────────────

const AGENTS: AgentDefinition[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'github-copilot', label: 'GitHub Copilot' },
  { id: 'gemini-cli', label: 'Gemini CLI' },
  { id: 'opencode', label: 'OpenCode' },
];

const SERVER_NAME = 'bDS';

// ── Engine ───────────────────────────────────────────────────────────

export class MCPAgentConfigEngine {
  private readonly homeDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly mcpUrl: string;
  private readonly execPath?: string;
  private readonly scriptPath?: string;

  constructor(opts: MCPAgentConfigOptions) {
    this.homeDir = opts.homeDir;
    this.platform = opts.platform;
    this.mcpUrl = opts.mcpUrl;
    this.execPath = opts.execPath;
    this.scriptPath = opts.scriptPath;
  }

  /** Return the list of supported agent definitions. */
  getAgents(): AgentDefinition[] {
    return [...AGENTS];
  }

  /** Resolve the absolute path to the config file for the given agent. */
  getConfigPath(agentId: MCPAgentId): string {
    switch (agentId) {
      case 'claude-code':
        return path.join(this.homeDir, '.claude.json');
      case 'claude-desktop':
        return this.claudeDesktopConfigPath();
      case 'github-copilot':
        return this.vsCodeMcpPath();
      case 'gemini-cli':
        return path.join(this.homeDir, '.gemini', 'settings.json');
      case 'opencode':
        return path.join(this.homeDir, '.opencode.json');
    }
  }

  /** Remove the bDS MCP server entry from the agent's config file. */
  removeFromConfig(agentId: MCPAgentId): AgentConfigResult {
    const configPath = this.getConfigPath(agentId);
    try {
      if (!existsSync(configPath)) {
        return { success: true, configPath };
      }
      const existing = this.readExisting(configPath);
      const serversKey = agentId === 'github-copilot' ? 'servers' : 'mcpServers';
      const currentServers = (existing[serversKey] as Record<string, unknown> | undefined) ?? {};
      if (!(SERVER_NAME in currentServers)) {
        return { success: true, configPath };
      }
      const { [SERVER_NAME]: _removed, ...remainingServers } = currentServers;
      const updated: Record<string, unknown> = { ...existing };
      if (Object.keys(remainingServers).length === 0) {
        delete updated[serversKey];
      } else {
        updated[serversKey] = remainingServers;
      }
      this.ensureDir(configPath);
      writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
      return { success: true, configPath };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, configPath, error: message };
    }
  }

  /** Read-merge-write the bDS MCP server entry into the agent's config file. */
  addToConfig(agentId: MCPAgentId): AgentConfigResult {
    const configPath = this.getConfigPath(agentId);
    try {
      const existing = this.readExisting(configPath);
      const merged = this.merge(agentId, existing);
      this.ensureDir(configPath);
      writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
      return { success: true, configPath };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, configPath, error: message };
    }
  }

  /** Check whether the bDS entry already exists in the agent's config. */
  isConfigured(agentId: MCPAgentId): boolean {
    const configPath = this.getConfigPath(agentId);
    if (!existsSync(configPath)) return false;
    try {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'));
      const serversKey = agentId === 'github-copilot' ? 'servers' : 'mcpServers';
      return !!data?.[serversKey]?.[SERVER_NAME];
    } catch {
      return false;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private claudeDesktopConfigPath(): string {
    if (this.platform === 'darwin') {
      return path.join(this.homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    }
    if (this.platform === 'win32') {
      return path.join(this.homeDir, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
    }
    return path.join(this.homeDir, '.config', 'Claude', 'claude_desktop_config.json');
  }

  private vsCodeMcpPath(): string {
    if (this.platform === 'darwin') {
      return path.join(this.homeDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
    }
    if (this.platform === 'win32') {
      return path.join(this.homeDir, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json');
    }
    // linux and others
    return path.join(this.homeDir, '.config', 'Code', 'User', 'mcp.json');
  }

  private readExisting(configPath: string): Record<string, unknown> {
    if (!existsSync(configPath)) return {};
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  private merge(agentId: MCPAgentId, existing: Record<string, unknown>): Record<string, unknown> {
    const entry = this.buildEntry(agentId);
    const serversKey = agentId === 'github-copilot' ? 'servers' : 'mcpServers';
    const currentServers = (existing[serversKey] as Record<string, unknown> | undefined) ?? {};

    return {
      ...existing,
      [serversKey]: {
        ...currentServers,
        [SERVER_NAME]: entry,
      },
    };
  }

  private buildEntry(agentId: MCPAgentId): Record<string, unknown> {
    switch (agentId) {
      case 'claude-code':
        return { type: 'http', url: this.mcpUrl };
      case 'claude-desktop': {
        if (!this.execPath || !this.scriptPath) {
          throw new Error(
            'claude-desktop requires execPath and scriptPath options in MCPAgentConfigOptions',
          );
        }
        return {
          command: this.execPath,
          args: [this.scriptPath],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        };
      }
      case 'github-copilot':
        return { type: 'http', url: this.mcpUrl };
      case 'gemini-cli':
        return { httpUrl: this.mcpUrl };
      case 'opencode':
        return { type: 'sse', url: this.mcpUrl };
    }
  }

  private ensureDir(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
