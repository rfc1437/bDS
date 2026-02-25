import { describe, expect, it } from 'vitest';
import { buildAssistantStartPrompt } from '../../../src/renderer/navigation/assistantPromptContext';

describe('assistantPromptContext', () => {
  it('enriches prompt with active post context', () => {
    const result = buildAssistantStartPrompt({
      userPrompt: 'Find weak tags',
      context: {
        tabType: 'post',
        id: 'post-1',
        title: 'Launch Notes',
      },
    });

    expect(result).toContain('User request: Find weak tags');
    expect(result).toContain('Current editor context type: post');
    expect(result).toContain('Current editor context id: post-1');
    expect(result).toContain('Current editor context title: Launch Notes');
  });

  it('enriches prompt with active media context', () => {
    const result = buildAssistantStartPrompt({
      userPrompt: 'Suggest alt text variants',
      context: {
        tabType: 'media',
        id: 'media-4',
        title: 'cover.jpg',
      },
    });

    expect(result).toContain('User request: Suggest alt text variants');
    expect(result).toContain('Current editor context type: media');
    expect(result).toContain('Current editor context id: media-4');
    expect(result).toContain('Current editor context title: cover.jpg');
  });

  it('falls back to none when no active editor context is available', () => {
    const result = buildAssistantStartPrompt({
      userPrompt: 'Summarize current project health',
      context: null,
    });

    expect(result).toContain('User request: Summarize current project health');
    expect(result).toContain('Current editor context type: none');
    expect(result).not.toContain('Current editor context id:');
  });
});
