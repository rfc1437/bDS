/**
 * EngineBundle — the collection of all engine instances constructed at startup.
 *
 * main.ts (Electron app) constructs these with NoopNotifier and passes them to
 * registerIpcHandlers() and MCPServer.
 *
 * bds-mcp.ts (CLI) constructs the subset it needs (post/media/script/template)
 * with DbNotifier and passes them to MCPServer.
 */

import type { PostEngine } from './PostEngine';
import type { MediaEngine } from './MediaEngine';
import type { ScriptEngine } from './ScriptEngine';
import type { TemplateEngine } from './TemplateEngine';
import type { MetaEngine } from './MetaEngine';
import type { MenuEngine } from './MenuEngine';
import type { TagEngine } from './TagEngine';
import type { PostMediaEngine } from './PostMediaEngine';
import type { ProjectEngine } from './ProjectEngine';
import type { GitEngine } from './GitEngine';
import type { GitApiAdapter } from './GitApiAdapter';
import type { BlogGenerationEngine } from './BlogGenerationEngine';
import type { PublishEngine } from './PublishEngine';
import type { MetadataDiffEngine } from './MetadataDiffEngine';
import type { TaskManager } from './TaskManager';
import type { BlogmarkTransformService } from './BlogmarkTransformService';
import type { MCPServer } from './MCPServer';
import type { BlogmarkPythonWorkerRuntime } from './BlogmarkPythonWorkerRuntime';
import type { PythonMacroWorkerRuntime } from './PythonMacroWorkerRuntime';
import type { PublishApiAdapter } from './PublishApiAdapter';
import type { AppApiAdapter } from './AppApiAdapter';

export interface EngineBundle {
  postEngine: PostEngine;
  mediaEngine: MediaEngine;
  scriptEngine: ScriptEngine;
  templateEngine: TemplateEngine;
  metaEngine: MetaEngine;
  menuEngine: MenuEngine;
  tagEngine: TagEngine;
  postMediaEngine: PostMediaEngine;
  projectEngine: ProjectEngine;
  gitEngine: GitEngine;
  gitApiAdapter: GitApiAdapter;
  blogGenerationEngine: BlogGenerationEngine;
  publishEngine: PublishEngine;
  metadataDiffEngine: MetadataDiffEngine;
  taskManager: TaskManager;
  blogmarkTransformService: BlogmarkTransformService;
  mcpServer: MCPServer;
  blogmarkPythonWorkerRuntime: BlogmarkPythonWorkerRuntime;
  pythonMacroWorkerRuntime: PythonMacroWorkerRuntime;
  publishApiAdapter: PublishApiAdapter;
  appApiAdapter: AppApiAdapter;
}
