import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH,
  applyAssistantSystemPromptAppToWorkspaceFeatures,
  applyAssistantSystemPromptWorkspaceToConsoleFeatures,
  normalizePromptValue,
  resolveAssistantSystemPromptAppFromWorkspaceSettings,
  resolveAssistantSystemPromptWorkspaceFromConsoleSettings,
  resolveAssistantSystemPromptsFromWorkspaceSettings
} from "../src/server/systemPrompt.js";

test("normalizePromptValue trims and enforces max length", () => {
  assert.equal(normalizePromptValue("  hello  "), "hello");
  assert.equal(normalizePromptValue(""), "");

  const longPrompt = "x".repeat(AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH + 20);
  assert.equal(normalizePromptValue(longPrompt).length, AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH);
});

test("workspace and console prompt resolvers normalize nested feature payloads", () => {
  const workspaceSettings = {
    features: {
      ai: {
        systemPrompts: {
          app: "  keep answers short  "
        }
      }
    }
  };
  const consoleSettings = {
    features: {
      ai: {
        systemPrompts: {
          workspace: "  use markdown headings  "
        }
      }
    }
  };

  assert.equal(resolveAssistantSystemPromptAppFromWorkspaceSettings(workspaceSettings), "keep answers short");
  assert.equal(
    resolveAssistantSystemPromptWorkspaceFromConsoleSettings(consoleSettings),
    "use markdown headings"
  );
  assert.deepEqual(resolveAssistantSystemPromptsFromWorkspaceSettings(workspaceSettings), {
    app: "keep answers short"
  });
});

test("prompt apply helpers patch nested feature structure without dropping siblings", () => {
  const baseFeatures = {
    invitesEnabled: true,
    ai: {
      model: "gpt-4",
      systemPrompts: {
        workspace: "existing console prompt"
      }
    }
  };

  const workspacePatched = applyAssistantSystemPromptAppToWorkspaceFeatures(baseFeatures, "new app prompt");
  assert.equal(workspacePatched.invitesEnabled, true);
  assert.equal(workspacePatched.ai.model, "gpt-4");
  assert.equal(workspacePatched.ai.systemPrompts.workspace, "existing console prompt");
  assert.equal(workspacePatched.ai.systemPrompts.app, "new app prompt");

  const consolePatched = applyAssistantSystemPromptWorkspaceToConsoleFeatures(baseFeatures, "new console prompt");
  assert.equal(consolePatched.ai.systemPrompts.workspace, "new console prompt");
});
