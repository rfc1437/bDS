import * as fs from 'fs/promises';
import matter from 'gray-matter';

export interface PostTranslationFileData {
  translationFor: string;
  language: string;
  title: string;
  excerpt?: string;
  content: string;
}

interface PostTranslationFileMetadata {
  translationFor?: string;
  language?: string;
  title?: string;
  excerpt?: string;
}

export async function readPostTranslationFile(filePath: string): Promise<PostTranslationFileData | null> {
  try {
    try {
      await fs.access(filePath);
    } catch {
      return null;
    }

    const fileContent = await fs.readFile(filePath, 'utf-8');
    const { data, content } = matter(fileContent);
    const metadata = data as PostTranslationFileMetadata;

    if (!metadata.translationFor || !metadata.language || !metadata.title) {
      return null;
    }

    return {
      translationFor: metadata.translationFor,
      language: metadata.language,
      title: metadata.title,
      excerpt: metadata.excerpt || undefined,
      content,
    };
  } catch (error) {
    console.error(`Failed to parse post translation file: ${filePath}`, error);
    return null;
  }
}