import type { AssistantEditorContext } from './assistantPromptContext';
import { buildAssistantStartPrompt } from './assistantPromptContext';

export interface AssistantRequestPlan {
  shouldCreateConversation: boolean;
  outboundMessage: string;
}

export function planAssistantRequest(input: {
  conversationId: string | null;
  userPrompt: string;
  context: AssistantEditorContext | null;
}): AssistantRequestPlan {
  const userPrompt = input.userPrompt.trim();

  if (input.conversationId) {
    return {
      shouldCreateConversation: false,
      outboundMessage: userPrompt,
    };
  }

  return {
    shouldCreateConversation: true,
    outboundMessage: buildAssistantStartPrompt({
      userPrompt,
      context: input.context,
    }),
  };
}
