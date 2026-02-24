import { describe, expect, it } from 'vitest';
import {
  BDS_PYTHON_API_CONTRACT_V1,
  getPythonApiMethodContract,
  listPythonApiMethodNames,
} from '../../../src/renderer/python/pythonApiContractV1';
import { generatePythonApiModuleV1 } from '../../../src/renderer/python/generatePythonApiModuleV1';

describe('pythonApiContractV1', () => {
  it('exposes broad stable method names for v1 contract', () => {
    const methodNames = listPythonApiMethodNames();

    expect(methodNames.length).toBeGreaterThan(40);
    expect(methodNames).toEqual(expect.arrayContaining([
      'projects.getAll',
      'posts.get',
      'posts.getAll',
      'posts.search',
      'media.get',
      'media.search',
      'meta.getProjectMetadata',
      'tags.getAll',
      'scripts.getAll',
      'tasks.getAll',
      'app.getSystemLanguage',
      'chat.getConversations',
      'chat.sendMessage',
    ]));
  });

  it('returns method contract metadata by name', () => {
    expect(getPythonApiMethodContract('posts.get')).toEqual({
      method: 'posts.get',
      description: 'Fetch one post by id.',
      params: [
        {
          name: 'postId',
          type: 'string',
          required: true,
        },
      ],
      returns: 'PostData | null',
    });
  });

  it('contains semantic version metadata for compatibility checks', () => {
    expect(BDS_PYTHON_API_CONTRACT_V1).toMatchObject({
      version: '1.3.0',
      generatedAt: expect.any(String),
    });
  });

  it('includes canonical data structures for response documentation', () => {
    expect(BDS_PYTHON_API_CONTRACT_V1.dataStructures).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'PostData' }),
      expect.objectContaining({ name: 'MediaData' }),
      expect.objectContaining({ name: 'ProjectData' }),
    ]));
  });
});

describe('generatePythonApiModuleV1', () => {
  it('generates python facade that hides transport details', () => {
    const moduleCode = generatePythonApiModuleV1();

    expect(moduleCode).toContain('class BdsApiError(Exception):');
    expect(moduleCode).toContain('class ProjectsApi:');
    expect(moduleCode).toContain('class PostsApi:');
    expect(moduleCode).toContain('class MediaApi:');
    expect(moduleCode).toContain('class MetaApi:');
    expect(moduleCode).toContain('class ChatApi:');
    expect(moduleCode).toContain('async def get(self, post_id):');
    expect(moduleCode).toContain('async def get_all(self, options=None):');
    expect(moduleCode).toContain('async def search(self, query):');
    expect(moduleCode).toContain('async def get_project_metadata(self):');
    expect(moduleCode).toContain('async def get_conversations(self):');
    expect(moduleCode).toContain('async def send_message(self, conversation_id, message):');
    expect(moduleCode).toContain('class BdsApi:');
    expect(moduleCode).toContain('bds = BdsApi(_transport)');
  });

  it('escapes python keyword method names to valid identifiers', () => {
    const moduleCode = generatePythonApiModuleV1();

    expect(moduleCode).toContain('return await self._transport.call("media.import", { "sourcePath": source_path, "metadata": metadata })');
    expect(moduleCode).toContain('async def import_(self, source_path, metadata=None):');
    expect(moduleCode).not.toContain('async def import(self, source_path, metadata=None):');
  });
});