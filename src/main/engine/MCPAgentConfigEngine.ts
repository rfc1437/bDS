/**
 * MCPAgentConfigEngine – adds the bDS MCP server entry to coding-agent config files.
 *
 * Supports: Claude Code, Claude Desktop, GitHub Copilot (VS Code), Gemini CLI,
 * OpenCode, Mistral Vibe, OpenAI Codex.
 *
 * All agents use the stdio-based standalone CLI server (`bds-mcp.cjs`), so the
 * app does NOT need to be running for coding agents to use MCP.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

// ── Public types ─────────────────────────────────────────────────────

export type MCPAgentId = 'claude-code' | 'claude-desktop' | 'github-copilot' | 'gemini-cli' | 'opencode' | 'mistral-vibe' | 'openai-codex';

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
  /** Absolute path to the Electron executable (used as the stdio command). */
  execPath: string;
  /** Absolute path to the bds-mcp.cjs script. */
  scriptPath: string;
}

// ── Agent definitions ────────────────────────────────────────────────

const AGENTS: AgentDefinition[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'github-copilot', label: 'GitHub Copilot' },
  { id: 'gemini-cli', label: 'Gemini CLI' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'mistral-vibe', label: 'Mistral Vibe' },
  { id: 'openai-codex', label: 'OpenAI Codex' },
];

const SERVER_NAME = 'bDS';

// ── Engine ───────────────────────────────────────────────────────────

export class MCPAgentConfigEngine {
  private readonly homeDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly execPath: string;
  private readonly scriptPath: string;

  constructor(opts: MCPAgentConfigOptions) {
    this.homeDir = opts.homeDir;
    this.platform = opts.platform;
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
    case 'mistral-vibe':
      return path.join(this.homeDir, '.vibe', 'config.toml');
    case 'openai-codex':
      return path.join(this.homeDir, '.codex', 'config.toml');
    }
  }

  /** Remove the bDS MCP server entry from the agent's config file. */
  removeFromConfig(agentId: MCPAgentId): AgentConfigResult {
    if (agentId === 'mistral-vibe') {
      return this.removeFromVibeConfig();
    }
    if (agentId === 'openai-codex') {
      return this.removeFromCodexConfig();
    }
    const configPath = this.getConfigPath(agentId);
    try {
      if (!existsSync(configPath)) {
        return { success: true, configPath };
      }
      const existing = this.readExistingJson(configPath);
      const serversKey = agentId === 'github-copilot' ? 'servers' : 'mcpServers';
      const currentServers = (existing[serversKey] as Record<string, unknown> | undefined) ?? {};
      if (!(SERVER_NAME in currentServers)) {
        return { success: true, configPath };
      }
      const { [SERVER_NAME]: _removed, ...remainingServers } = currentServers;
      void _removed;
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
    if (agentId === 'mistral-vibe') {
      return this.addToVibeConfig();
    }
    if (agentId === 'openai-codex') {
      return this.addToCodexConfig();
    }
    const configPath = this.getConfigPath(agentId);
    try {
      const existing = this.readExistingJson(configPath);
      const merged = this.mergeJson(agentId, existing);
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
    if (agentId === 'mistral-vibe') {
      return this.isVibeConfigured();
    }
    if (agentId === 'openai-codex') {
      return this.isCodexConfigured();
    }
    const configPath = this.getConfigPath(agentId);
    if (!existsSync(configPath)) {
      return false;
    }
    try {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'));
      const serversKey = agentId === 'github-copilot' ? 'servers' : 'mcpServers';
      return !!data?.[serversKey]?.[SERVER_NAME];
    } catch {
      return false;
    }
  }

  // ── Mistral Vibe (TOML) helpers ──────────────────────────────────

  private addToVibeConfig(): AgentConfigResult {
    const configPath = this.getConfigPath('mistral-vibe');
    try {
      const existing = this.readExistingToml(configPath);
      const servers = (existing.mcp_servers ?? []) as Record<string, unknown>[];
      // Remove any existing bDS entry before adding a fresh one.
      const filtered = servers.filter((s) => s.name !== SERVER_NAME);
      filtered.push({
        name: SERVER_NAME,
        transport: 'stdio',
        command: this.execPath,
        args: [this.scriptPath],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      });
      existing.mcp_servers = filtered;
      this.ensureDir(configPath);
      writeFileSync(configPath, stringifyToml(existing) + '\n', 'utf-8');
      return { success: true, configPath };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, configPath, error: message };
    }
  }

  private removeFromVibeConfig(): AgentConfigResult {
    const configPath = this.getConfigPath('mistral-vibe');
    try {
      if (!existsSync(configPath)) {
        return { success: true, configPath };
      }
      const existing = this.readExistingToml(configPath);
      const servers = (existing.mcp_servers ?? []) as Record<string, unknown>[];
      const filtered = servers.filter((s) => s.name !== SERVER_NAME);
      if (filtered.length === servers.length) {
        // Nothing to remove
        return { success: true, configPath };
      }
      if (filtered.length === 0) {
        delete existing.mcp_servers;
      } else {
        existing.mcp_servers = filtered;
      }
      this.ensureDir(configPath);
      writeFileSync(configPath, stringifyToml(existing) + '\n', 'utf-8');
      return { success: true, configPath };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, configPath, error: message };
    }
  }

  private isVibeConfigured(): boolean {
    const configPath = this.getConfigPath('mistral-vibe');
    if (!existsSync(configPath)) {
      return false;
    }
    try {
      const existing = this.readExistingToml(configPath);
      const servers = (existing.mcp_servers ?? []) as Record<string, unknown>[];
      return servers.some((s) => s.name === SERVER_NAME);
    } catch {
      return false;
    }
  }

  private readExistingToml(configPath: string): Record<string, unknown> {
    if (!existsSync(configPath)) {
      return {};
    }
    const raw = readFileSync(configPath, 'utf-8');
    return parseToml(raw) as Record<string, unknown>;
  }

  // ── OpenAI Codex (TOML, table-based) helpers ────────────────────

  private addToCodexConfig(): AgentConfigResult {
    const configPath = this.getConfigPath('openai-codex');
    try {
      const existing = this.readExistingToml(configPath);
      const servers = (existing.mcp_servers ?? {}) as Record<string, unknown>;
      servers[SERVER_NAME] = {
        command: this.execPath,
        args: [this.scriptPath],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      };
      existing.mcp_servers = servers;
      this.ensureDir(configPath);
      writeFileSync(configPath, stringifyToml(existing) + '\n', 'utf-8');
      return { success: true, configPath };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, configPath, error: message };
    }
  }

  private removeFromCodexConfig(): AgentConfigResult {
    const configPath = this.getConfigPath('openai-codex');
    try {
      if (!existsSync(configPath)) {
        return { success: true, configPath };
      }
      const existing = this.readExistingToml(configPath);
      const servers = (existing.mcp_servers ?? {}) as Record<string, unknown>;
      if (!(SERVER_NAME in servers)) {
        return { success: true, configPath };
      }
      delete servers[SERVER_NAME];
      if (Object.keys(servers).length === 0) {
        delete existing.mcp_servers;
      } else {
        existing.mcp_servers = servers;
      }
      this.ensureDir(configPath);
      writeFileSync(configPath, stringifyToml(existing) + '\n', 'utf-8');
      return { success: true, configPath };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, configPath, error: message };
    }
  }

  private isCodexConfigured(): boolean {
    const configPath = this.getConfigPath('openai-codex');
    if (!existsSync(configPath)) {
      return false;
    }
    try {
      const existing = this.readExistingToml(configPath);
      const servers = (existing.mcp_servers ?? {}) as Record<string, unknown>;
      return SERVER_NAME in servers;
    } catch {
      return false;
    }
  }

  // ── JSON helpers ─────────────────────────────────────────────────

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

  private readExistingJson(configPath: string): Record<string, unknown> {
    if (!existsSync(configPath)) {
      return {};
    }
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  private mergeJson(agentId: MCPAgentId, existing: Record<string, unknown>): Record<string, unknown> {
    const entry = this.buildJsonEntry(agentId);
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

  private buildJsonEntry(agentId: MCPAgentId): Record<string, unknown> {
    const stdioEntry = {
      command: this.execPath,
      args: [this.scriptPath],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };

    switch (agentId) {
    case 'claude-code':
    case 'claude-desktop':
    case 'gemini-cli':
      return stdioEntry;
    case 'github-copilot':
    case 'opencode':
      return { type: 'stdio', ...stdioEntry };
    case 'mistral-vibe':
    case 'openai-codex':
      // TOML-based; handled separately — should not reach here.
      return stdioEntry;
    }
  }

  private ensureDir(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
