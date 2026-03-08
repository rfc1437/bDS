/**
 * OneShotTasks — non-streaming AI tasks using generateText().
 *
 * One-shot AI tasks: taxonomy analysis and image analysis.
 * with provider-agnostic AI SDK calls.
 */

import { generateText } from 'ai';
import type { ChatEngine } from '../ChatEngine';
import type { MediaEngine } from '../MediaEngine';
import type { PostEngine } from '../PostEngine';
import { ProviderRegistry } from './providers';
import { resolveSupportedRenderLanguage, translateRender } from '../../shared/i18n';
import { slugify } from '../slugify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaxonomyAnalysisResult {
  success: boolean;
  categoryMappings?: Record<string, string>;
  tagMappings?: Record<string, string>;
  error?: string;
}

export interface ImageAnalysisResult {
  success: boolean;
  title?: string;
  alt?: string;
  caption?: string;
  error?: string;
}

export interface LanguageDetectionResult {
  success: boolean;
  language?: string;
  error?: string;
}

export interface PostAnalysisResult {
  success: boolean;
  title?: string;
  excerpt?: string;
  slug?: string;
  error?: string;
}

export interface PostTranslationResult {
  success: boolean;
  translation?: Awaited<ReturnType<PostEngine['upsertPostTranslation']>>;
  error?: string;
}

export interface MediaTranslationResult {
  success: boolean;
  translation?: Awaited<ReturnType<MediaEngine['upsertMediaTranslation']>>;
  error?: string;
}

export function normalizeTranslatedMarkdownBody(content: string, sourceContent: string): string {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return '';
  }

  const leadingLabelPattern = /^(content|inhalt|contenu|contenuto|contenido):\s*\n\s*\n/i;
  if (!leadingLabelPattern.test(normalizedContent) || leadingLabelPattern.test(sourceContent.trim())) {
    return normalizedContent;
  }

  return normalizedContent.replace(leadingLabelPattern, '');
}

// ---------------------------------------------------------------------------
// OneShotTasks
// ---------------------------------------------------------------------------

export class OneShotTasks {
  private providers: ProviderRegistry;
  private chatEngine: ChatEngine;
  private mediaEngine: MediaEngine;
  private postEngine?: PostEngine;

  constructor(
    providers: ProviderRegistry,
    chatEngine: ChatEngine,
    mediaEngine: MediaEngine,
    postEngine?: PostEngine,
  ) {
    this.providers = providers;
    this.chatEngine = chatEngine;
    this.mediaEngine = mediaEngine;
    this.postEngine = postEngine;
  }

  /**
   * Analyze taxonomy items from a WordPress import and suggest mappings
   * from NEW items to EXISTING items to avoid duplicates.
   */
  async analyzeTaxonomy(
    categories: Array<{ name: string; slug: string; existsInProject: boolean }>,
    tags: Array<{ name: string; slug: string; existsInProject: boolean }>,
    modelId: string,
  ): Promise<TaxonomyAnalysisResult> {
    const provider = this.providers.detectModelProvider(modelId);
    if (!this.providers.isProviderKeySet(provider)) {
      const providerLabel = provider === 'mistral' ? 'Mistral' : provider === 'ollama' ? 'Ollama' : provider === 'lmstudio' ? 'LM Studio' : 'OpenCode';
      return { success: false, error: `${providerLabel} API key not set` };
    }

    const existingCategories = categories.filter(c => c.existsInProject).map(c => c.name);
    const newCategories = categories.filter(c => !c.existsInProject).map(c => c.name);
    const existingTags = tags.filter(t => t.existsInProject).map(t => t.name);
    const newTags = tags.filter(t => !t.existsInProject).map(t => t.name);

    const systemPrompt = `You are an expert at analyzing taxonomy terms (tags and categories) for a blog import system.

Your task is to identify NEW tags/categories from an import that should be mapped to EXISTING tags/categories in the project to avoid creating duplicates.

CRITICAL RULES:
1. ONLY map NEW items to EXISTING items - never map new to new
2. The goal is to prevent duplicate creation, NOT to reduce the number of new items
3. A new item should only map to an existing item if they represent the same concept
4. Consider language differences: a new tag can match an existing tag in a different language (e.g., "Photography" should map to "Fotografie" if that exists)
5. Consider variations like: different casing, singular/plural, abbreviations, hyphenation, synonyms
6. Only suggest mappings where there is a clear semantic match - not every new item needs a mapping

EXAMPLES OF VALID MAPPINGS (new → existing):
- "Photos" → "Photography" (if Photography exists)
- "Fotografie" → "Photography" (language variation, if Photography exists)  
- "tech" → "Technology" (abbreviation, if Technology exists)
- "Web Dev" → "Web Development" (abbreviation, if Web Development exists)

DO NOT:
- Map a new item to another new item
- Suggest mappings just because items are in the same topic area
- Create mappings for items that are distinct concepts

RESPONSE FORMAT:
You MUST respond with valid JSON only, no other text. Use this exact structure:
{
  "categoryMappings": { "New Category": "Existing Category", ... },
  "tagMappings": { "New Tag": "Existing Tag", ... }
}

The source (key) MUST be from the NEW items list, and the target (value) MUST be from the EXISTING items list.
If there are no sensible mappings to suggest, return empty objects.`;

    const userPrompt = `Analyze these taxonomy items from a WordPress import. Identify NEW items that should be mapped to EXISTING items to avoid duplicates.

EXISTING CATEGORIES IN PROJECT (map TO these):
${existingCategories.length > 0 ? existingCategories.join(', ') : '(none)'}

NEW CATEGORIES FROM IMPORT (map FROM these):
${newCategories.length > 0 ? newCategories.join(', ') : '(none)'}

EXISTING TAGS IN PROJECT (map TO these):
${existingTags.length > 0 ? existingTags.join(', ') : '(none)'}

NEW TAGS FROM IMPORT (map FROM these):
${newTags.length > 0 ? newTags.join(', ') : '(none)'}

Remember: Only suggest mappings from NEW items to EXISTING items. Consider language differences (e.g., German/English equivalents). Response must be valid JSON only.`;

    try {
      const model = this.providers.resolveModel(modelId);

      const { text } = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 4096,
        maxRetries: 2,
      });

      // Extract and parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { success: false, error: 'Invalid response format from AI' };
      }

      const result = JSON.parse(jsonMatch[0]);

      // Validate mappings: only new→existing allowed
      const validatedCategoryMappings: Record<string, string> = {};
      const validatedTagMappings: Record<string, string> = {};

      const newCatSet = new Set(newCategories);
      const existingCatSet = new Set(existingCategories);
      for (const [source, target] of Object.entries(result.categoryMappings || {})) {
        if (newCatSet.has(source) && existingCatSet.has(target as string)) {
          validatedCategoryMappings[source] = target as string;
        }
      }

      const newTagSet = new Set(newTags);
      const existingTagSet = new Set(existingTags);
      for (const [source, target] of Object.entries(result.tagMappings || {})) {
        if (newTagSet.has(source) && existingTagSet.has(target as string)) {
          validatedTagMappings[source] = target as string;
        }
      }

      return {
        success: true,
        categoryMappings: validatedCategoryMappings,
        tagMappings: validatedTagMappings,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Analyze an image and generate title, alt text, and caption.
   * Uses multimodal input — AI SDK handles the provider-specific format.
   */
  async analyzeMediaImage(
    mediaId: string,
    language: string = 'en',
  ): Promise<ImageAnalysisResult> {
    // Determine model with smart fallback
    let modelId = await this.chatEngine.getSetting('chat_image_analysis_model');
    if (!modelId || !this.providers.isProviderKeySet(this.providers.detectModelProvider(modelId))) {
      modelId = this.providers.getOpencodeKey()
        ? 'claude-sonnet-4-5'
        : this.providers.getMistralKey()
          ? 'mistral-large-latest'
          : null;
    }

    // In offline mode, swap to the configured offline image analysis model
    if (this.providers.isOfflineMode()) {
      const offlineModel = await this.chatEngine.getSetting('offline_image_analysis_model')
        || this.providers.getFirstKnownLocalVisionModelId()
        || this.providers.getFirstKnownLocalModelId();
      if (offlineModel) {
        modelId = offlineModel;
      } else if (!modelId || (!this.providers.isOllamaModel(modelId) && !this.providers.isLmstudioModel(modelId))) {
        return { success: false, error: 'No offline image analysis model configured. Set one in Settings → AI → Airplane Mode.' };
      }
    }

    if (!modelId) {
      return { success: false, error: 'API key not configured. Please set an API key in Settings.' };
    }

    // Get media metadata
    const mediaItem = await this.mediaEngine.getMedia(mediaId);
    if (!mediaItem) return { success: false, error: 'Media item not found' };
    if (!mediaItem.mimeType.startsWith('image/')) {
      return { success: false, error: `Cannot analyze this file type: ${mediaItem.mimeType}. Only images are supported.` };
    }

    // Get AI-optimised JPEG thumbnail (512px, pre-generated).
    // Falls back to large/medium WebP thumbnails for older media items.
    let dataUrl = await this.mediaEngine.getThumbnailDataUrl(mediaId, 'ai');
    let needsConversion = false;
    if (!dataUrl) {
      dataUrl = await this.mediaEngine.getThumbnailDataUrl(mediaId, 'large');
      needsConversion = true;
    }
    if (!dataUrl) {
      dataUrl = await this.mediaEngine.getThumbnailDataUrl(mediaId, 'medium');
      needsConversion = true;
    }
    if (!dataUrl) {
      return { success: false, error: 'Image thumbnail not available. Try regenerating thumbnails from Settings.' };
    }

    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');

    let jpegBase64: string;
    if (needsConversion) {
      // Legacy path: convert WebP thumbnail to JPEG for model compatibility.
      const sharp = (await import('sharp')).default;
      const jpegBuffer = await sharp(Buffer.from(base64Data, 'base64'))
        .jpeg({ quality: 85 })
        .toBuffer();
      jpegBase64 = jpegBuffer.toString('base64');
    } else {
      // Fast path: AI thumbnail is already JPEG — use directly.
      jpegBase64 = base64Data;
    }

    const renderLanguage = resolveSupportedRenderLanguage(language);
    const systemPrompt = translateRender(renderLanguage, 'ai.imageAnalysis.system');
    const userPrompt = translateRender(renderLanguage, 'ai.imageAnalysis.user');

    try {
      const model = this.providers.resolveModel(modelId);

      // AI SDK handles provider-specific multimodal format automatically
      const { text } = await generateText({
        model,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', image: `data:image/jpeg;base64,${jpegBase64}` },
            { type: 'text', text: userPrompt },
          ],
        }],
        maxOutputTokens: 200,
        maxRetries: 2,
      });

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { success: false, error: 'Invalid response format from AI' };

      const result = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        title: result.title || undefined,
        alt: result.alt || undefined,
        caption: result.caption || undefined,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Detect the language of a post based on its title and content.
   * Uses the configured title model (lightweight, text-only).
   */
  async detectPostLanguage(
    title: string,
    content: string,
  ): Promise<LanguageDetectionResult> {
    // Use the title model — lightweight, text-only task
    let modelId = await this.chatEngine.getSetting('chat_title_model');
    if (!modelId || !this.providers.isProviderKeySet(this.providers.detectModelProvider(modelId))) {
      modelId = this.providers.getOpencodeKey()
        ? 'claude-sonnet-4-5'
        : this.providers.getMistralKey()
          ? 'mistral-large-latest'
          : null;
    }

    // In offline mode, swap to configured offline title model
    if (this.providers.isOfflineMode()) {
      const offlineModel = await this.chatEngine.getSetting('offline_title_model')
        || this.providers.getFirstKnownLocalModelId();
      if (offlineModel) {
        modelId = offlineModel;
      } else if (!modelId || (!this.providers.isOllamaModel(modelId) && !this.providers.isLmstudioModel(modelId))) {
        return { success: false, error: 'No offline model configured. Set one in Settings → AI → Airplane Mode.' };
      }
    }

    if (!modelId) {
      return { success: false, error: 'API key not configured. Please set an API key in Settings.' };
    }

    const snippet = content.slice(0, 500);
    const supportedLanguages = ['en', 'de', 'fr', 'it', 'es'];

    const systemPrompt = `You are a language detection assistant. Given a blog post title and a content snippet, determine the language of the text. Respond with ONLY a JSON object: { "language": "<code>" } where <code> is one of: ${supportedLanguages.join(', ')}. If the language is not in the list, pick the closest match. No other text.`;

    const userPrompt = `Title: ${title}\n\nContent:\n${snippet}`;

    try {
      const model = this.providers.resolveModel(modelId);

      const { text } = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 50,
        maxRetries: 2,
      });

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { success: false, error: 'Invalid response format from AI' };

      const result = JSON.parse(jsonMatch[0]);
      const detected = (result.language || '').toLowerCase().trim();
      if (!supportedLanguages.includes(detected)) {
        return { success: false, error: `Unsupported language detected: ${detected}` };
      }

      return { success: true, language: detected };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Analyze a blog post and suggest title, excerpt (plain text), and slug.
   * Uses the configured title model (text-only).
   */
  async analyzePost(
    postId: string,
    language: string = 'en',
  ): Promise<PostAnalysisResult> {
    if (!this.postEngine) {
      return { success: false, error: 'Post engine not available' };
    }

    // Load post (resolves content from filesystem for published posts)
    const post = await this.postEngine.getPost(postId);
    if (!post) return { success: false, error: 'Post not found' };
    if (!post.content || post.content.trim().length === 0) {
      return { success: false, error: 'Post has no content to analyze' };
    }

    // Use the title model — lightweight, text-only task
    let modelId = await this.chatEngine.getSetting('chat_title_model');
    if (!modelId || !this.providers.isProviderKeySet(this.providers.detectModelProvider(modelId))) {
      modelId = this.providers.getOpencodeKey()
        ? 'claude-sonnet-4-5'
        : this.providers.getMistralKey()
          ? 'mistral-large-latest'
          : null;
    }

    // In offline mode, swap to configured offline title model
    if (this.providers.isOfflineMode()) {
      const offlineModel = await this.chatEngine.getSetting('offline_title_model')
        || this.providers.getFirstKnownLocalModelId();
      if (offlineModel) {
        modelId = offlineModel;
      } else if (!modelId || (!this.providers.isOllamaModel(modelId) && !this.providers.isLmstudioModel(modelId))) {
        return { success: false, error: 'No offline model configured. Set one in Settings → AI → Airplane Mode.' };
      }
    }

    if (!modelId) {
      return { success: false, error: 'API key not configured. Please set an API key in Settings.' };
    }

    const snippet = post.content.slice(0, 2000);
    const renderLanguage = resolveSupportedRenderLanguage(language);
    const systemPrompt = translateRender(renderLanguage, 'ai.postAnalysis.system');
    const userPrompt = translateRender(renderLanguage, 'ai.postAnalysis.user')
      .replace('{title}', post.title || '')
      .replace('{content}', snippet);

    try {
      const model = this.providers.resolveModel(modelId);

      const { text } = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 500,
        maxRetries: 2,
      });

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { success: false, error: 'Invalid response format from AI' };

      const result = JSON.parse(jsonMatch[0]);

      // Sanitize slug: lowercase, hyphens only
      let resultSlug = result.slug ? slugify(result.slug) : undefined;
      if (resultSlug === '') resultSlug = undefined;

      return {
        success: true,
        title: result.title || undefined,
        excerpt: result.excerpt || undefined,
        slug: resultSlug,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async translatePost(postId: string, targetLanguage: string): Promise<PostTranslationResult> {
    if (!this.postEngine) {
      return { success: false, error: 'Post engine not available' };
    }

    const post = await this.postEngine.getPost(postId);
    if (!post) {
      return { success: false, error: 'Post not found' };
    }
    if (!post.content || post.content.trim().length === 0) {
      return { success: false, error: 'Post has no content to translate' };
    }

    let modelId = await this.chatEngine.getSetting('chat_title_model');
    if (!modelId || !this.providers.isProviderKeySet(this.providers.detectModelProvider(modelId))) {
      modelId = this.providers.getOpencodeKey()
        ? 'claude-sonnet-4-5'
        : this.providers.getMistralKey()
          ? 'mistral-large-latest'
          : null;
    }

    if (this.providers.isOfflineMode()) {
      const offlineModel = await this.chatEngine.getSetting('offline_title_model')
        || this.providers.getFirstKnownLocalModelId();
      if (offlineModel) {
        modelId = offlineModel;
      } else if (!modelId || (!this.providers.isOllamaModel(modelId) && !this.providers.isLmstudioModel(modelId))) {
        return { success: false, error: 'No offline model configured. Set one in Settings → AI → Airplane Mode.' };
      }
    }

    if (!modelId) {
      return { success: false, error: 'API key not configured. Please set an API key in Settings.' };
    }

    const sourceLanguage = post.language || 'en';
    const metadataSystemPrompt = `You translate blog post metadata. Return ONLY valid JSON with keys title and excerpt. Do not add commentary. Do not invent or add any text that is not present in the source. Only translate the given text. Translate from ${sourceLanguage} to ${targetLanguage}.`;
    const metadataUserPrompt = [
      `Title: ${post.title}`,
      `Excerpt: ${post.excerpt || ''}`,
    ].join('\n\n');
    const contentSystemPrompt = `You translate blog post Markdown bodies. Return ONLY the translated Markdown body, with no JSON envelope and no commentary. Preserve Markdown structure. Leave text inside fenced code blocks untranslated. Do not invent, add, or generate any text that is not present in the source. Only translate the exact text provided. If the content contains only macro calls, shortcodes, or other non-translatable tokens, return them unchanged. If the source body is empty, return an empty string. Translate from ${sourceLanguage} to ${targetLanguage}.`;
    const contentUserPrompt = post.content;

    try {
      const model = this.providers.resolveModel(modelId);
      const { text: metadataText } = await generateText({
        model,
        system: metadataSystemPrompt,
        prompt: metadataUserPrompt,
        maxOutputTokens: 500,
        maxRetries: 2,
      });

      const { text: translatedContent } = await generateText({
        model,
        system: contentSystemPrompt,
        prompt: contentUserPrompt,
        maxOutputTokens: 4000,
        maxRetries: 2,
      });

      let parsed: { title?: string; excerpt?: string } | null = null;
      const jsonMatch = metadataText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = null;
        }
      }

      const normalizedTranslatedContent = normalizeTranslatedMarkdownBody(translatedContent || '', post.content);

      const translation = await this.postEngine.upsertPostTranslation(postId, targetLanguage, {
        title: parsed?.title || post.title,
        excerpt: parsed?.excerpt || post.excerpt || undefined,
        content: normalizedTranslatedContent,
      });

      return {
        success: true,
        translation,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Detect the language of media metadata (title, alt, caption).
   * Uses the configured title model (lightweight, text-only).
   */
  async detectMediaLanguage(
    title: string,
    alt: string,
    caption: string,
  ): Promise<LanguageDetectionResult> {
    const combined = [title, alt, caption].filter(Boolean).join('\n');
    if (!combined.trim()) {
      return { success: false, error: 'No metadata text provided for language detection' };
    }

    let modelId = await this.chatEngine.getSetting('chat_title_model');
    if (!modelId || !this.providers.isProviderKeySet(this.providers.detectModelProvider(modelId))) {
      modelId = this.providers.getOpencodeKey()
        ? 'claude-sonnet-4-5'
        : this.providers.getMistralKey()
          ? 'mistral-large-latest'
          : null;
    }

    if (this.providers.isOfflineMode()) {
      const offlineModel = await this.chatEngine.getSetting('offline_title_model')
        || this.providers.getFirstKnownLocalModelId();
      if (offlineModel) {
        modelId = offlineModel;
      } else if (!modelId || (!this.providers.isOllamaModel(modelId) && !this.providers.isLmstudioModel(modelId))) {
        return { success: false, error: 'No offline model configured. Set one in Settings → AI → Airplane Mode.' };
      }
    }

    if (!modelId) {
      return { success: false, error: 'API key not configured. Please set an API key in Settings.' };
    }

    const supportedLanguages = ['en', 'de', 'fr', 'it', 'es'];
    const systemPrompt = `You are a language detection assistant. Given image metadata (title, alt text, caption), determine the language. Respond with ONLY a JSON object: { "language": "<code>" } where <code> is one of: ${supportedLanguages.join(', ')}. If the language is not in the list, pick the closest match. No other text.`;
    const userPrompt = `Title: ${title}\nAlt: ${alt}\nCaption: ${caption}`;

    try {
      const model = this.providers.resolveModel(modelId);
      const { text } = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 50,
        maxRetries: 2,
      });

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { success: false, error: 'Invalid response format from AI' };

      const result = JSON.parse(jsonMatch[0]);
      const detected = (result.language || '').toLowerCase().trim();
      if (!supportedLanguages.includes(detected)) {
        return { success: false, error: `Unsupported language detected: ${detected}` };
      }

      return { success: true, language: detected };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Translate media metadata (title, alt, caption) into a target language.
   * Persists the result as a media translation via MediaEngine.
   */
  async translateMediaMetadata(
    mediaId: string,
    targetLanguage: string,
  ): Promise<MediaTranslationResult> {
    const mediaItem = await this.mediaEngine.getMedia(mediaId);
    if (!mediaItem) {
      return { success: false, error: 'Media item not found' };
    }

    const hasMetadata = mediaItem.title || mediaItem.alt || mediaItem.caption;
    if (!hasMetadata) {
      return { success: false, error: 'Media item has no metadata to translate' };
    }

    let modelId = await this.chatEngine.getSetting('chat_title_model');
    if (!modelId || !this.providers.isProviderKeySet(this.providers.detectModelProvider(modelId))) {
      modelId = this.providers.getOpencodeKey()
        ? 'claude-sonnet-4-5'
        : this.providers.getMistralKey()
          ? 'mistral-large-latest'
          : null;
    }

    if (this.providers.isOfflineMode()) {
      const offlineModel = await this.chatEngine.getSetting('offline_title_model')
        || this.providers.getFirstKnownLocalModelId();
      if (offlineModel) {
        modelId = offlineModel;
      } else if (!modelId || (!this.providers.isOllamaModel(modelId) && !this.providers.isLmstudioModel(modelId))) {
        return { success: false, error: 'No offline model configured. Set one in Settings → AI → Airplane Mode.' };
      }
    }

    if (!modelId) {
      return { success: false, error: 'API key not configured. Please set an API key in Settings.' };
    }

    const sourceLanguage = mediaItem.language || 'en';
    const systemPrompt = `You translate image metadata. Return ONLY valid JSON with keys title, alt, caption. Do not add commentary. Translate from ${sourceLanguage} to ${targetLanguage}. If a field is null or empty, return it as null.`;
    const userPrompt = [
      `Title: ${mediaItem.title || ''}`,
      `Alt: ${mediaItem.alt || ''}`,
      `Caption: ${mediaItem.caption || ''}`,
    ].join('\n');

    try {
      const model = this.providers.resolveModel(modelId);
      const { text } = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 300,
        maxRetries: 2,
      });

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { success: false, error: 'Invalid response format from AI' };

      const parsed = JSON.parse(jsonMatch[0]);

      const translation = await this.mediaEngine.upsertMediaTranslation(mediaId, targetLanguage, {
        title: parsed.title || undefined,
        alt: parsed.alt || undefined,
        caption: parsed.caption || undefined,
      });

      return { success: true, translation };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}
