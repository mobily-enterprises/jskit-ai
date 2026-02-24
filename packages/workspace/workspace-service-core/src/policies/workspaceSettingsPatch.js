import { createWorkspaceSettingsPatchPolicy } from "@jskit-ai/workspace-console-core/workspaceSettingsPatch";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { normalizeEmail } from "@jskit-ai/access-core/utils";
import { isWorkspaceColor } from "@jskit-ai/workspace-console-core/workspaceColors";
import { TRANSCRIPT_MODE_VALUES } from "@jskit-ai/assistant-transcripts-core";
import { AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH } from "@jskit-ai/assistant-core/systemPrompt";

const { parseWorkspaceSettingsPatch } = createWorkspaceSettingsPatchPolicy({
  createValidationError(status, message, options = {}) {
    return new AppError(status, message, options);
  },
  normalizeEmail,
  isWorkspaceColor,
  transcriptModeValues: TRANSCRIPT_MODE_VALUES,
  assistantSystemPromptMaxLength: AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH
});

export { parseWorkspaceSettingsPatch };
