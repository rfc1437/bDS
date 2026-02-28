import { readFileSync, writeFileSync } from 'fs';

const files = [
  'src/main/ipc/handlers.ts',
  'src/main/ipc/blogHandlers.ts',
  'src/main/ipc/publishHandlers.ts',
  'src/main/ipc/chatHandlers.ts',
  'src/main/ipc/metadataDiffHandlers.ts',
];

const replacements = [
  [/getPostEngine\(\)/g, 'bundle.postEngine'],
  [/getMediaEngine\(\)/g, 'bundle.mediaEngine'],
  [/getProjectEngine\(\)/g, 'bundle.projectEngine'],
  [/getMetaEngine\(\)/g, 'bundle.metaEngine'],
  [/getMenuEngine\(\)/g, 'bundle.menuEngine'],
  [/getTagEngine\(\)/g, 'bundle.tagEngine'],
  [/getScriptEngine\(\)/g, 'bundle.scriptEngine'],
  [/getTemplateEngine\(\)/g, 'bundle.templateEngine'],
  [/getGitEngine\(\)/g, 'bundle.gitEngine'],
  [/getBlogGenerationEngine\(\)/g, 'bundle.blogGenerationEngine'],
  [/getPublishEngine\(\)/g, 'bundle.publishEngine'],
  [/getMetadataDiffEngine\(\)/g, 'bundle.metadataDiffEngine'],
];

for (const file of files) {
  let content = readFileSync(file, 'utf8');
  for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
  }
  writeFileSync(file, content, 'utf8');
  console.log(`Updated: ${file}`);
}
