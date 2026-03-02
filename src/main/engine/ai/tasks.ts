/**
 * OneShotTasks — non-streaming AI tasks using generateText().
 *
 * One-shot AI tasks: taxonomy analysis and image analysis.
 * with provider-agnostic AI SDK calls.
 */

import { generateText } from 'ai';
import type { ChatEngine } from '../ChatEngine';
import type { MediaEngine } from '../MediaEngine';
import { ProviderRegistry } from './providers';
import { resolveSupportedRenderLanguage, translateRender } from '../../shared/i18n';

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

// ---------------------------------------------------------------------------
// OneShotTasks
// ---------------------------------------------------------------------------

export class OneShotTasks {
  private providers: ProviderRegistry;
  private chatEngine: ChatEngine;
  private mediaEngine: MediaEngine;

  constructor(
    providers: ProviderRegistry,
    chatEngine: ChatEngine,
    mediaEngine: MediaEngine,
  ) {
    this.providers = providers;
    this.chatEngine = chatEngine;
    this.mediaEngine = mediaEngine;
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
      const offlineModel = await this.chatEngine.getSetting('offline_image_analysis_model');
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

    // Get thumbnail
    let dataUrl = await this.mediaEngine.getThumbnailDataUrl(mediaId, 'large');
    if (!dataUrl) dataUrl = await this.mediaEngine.getThumbnailDataUrl(mediaId, 'medium');
    if (!dataUrl) {
      return { success: false, error: 'Image thumbnail not available. Try regenerating thumbnails from Settings.' };
    }

    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');

    // Convert WebP thumbnail to JPEG for universal model compatibility.
    // Local providers like LM Studio reject WebP in the data URL.
    const sharp = (await import('sharp')).default;
    const jpegBuffer = await sharp(Buffer.from(base64Data, 'base64'))
      .jpeg({ quality: 85 })
      .toBuffer();
    const jpegBase64 = jpegBuffer.toString('base64');

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
}
