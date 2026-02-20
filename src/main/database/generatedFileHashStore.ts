import { getDatabase } from './connection';

export async function getGeneratedFileHash(projectId: string, relativePath: string): Promise<string | null> {
  const client = getDatabase().getLocalClient();
  if (!client) {
    throw new Error('Database client not available');
  }

  const result = await client.execute({
    sql: 'SELECT content_hash FROM generated_file_hashes WHERE project_id = ? AND relative_path = ? LIMIT 1',
    args: [projectId, relativePath],
  });

  if (!result.rows[0] || typeof result.rows[0].content_hash !== 'string') {
    return null;
  }

  return result.rows[0].content_hash;
}

export async function setGeneratedFileHash(projectId: string, relativePath: string, hash: string): Promise<void> {
  const client = getDatabase().getLocalClient();
  if (!client) {
    throw new Error('Database client not available');
  }

  await client.execute({
    sql: `
      INSERT INTO generated_file_hashes (project_id, relative_path, content_hash, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, relative_path)
      DO UPDATE SET content_hash = excluded.content_hash, updated_at = excluded.updated_at
    `,
    args: [projectId, relativePath, hash, Date.now()],
  });
}
