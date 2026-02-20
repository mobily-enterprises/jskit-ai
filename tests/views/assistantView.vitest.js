import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const assistantViewPath = path.join(rootDir, "src/views/assistant/AssistantView.vue");

function readAssistantViewSource() {
  return readFileSync(assistantViewPath, "utf8");
}

describe("AssistantView template", () => {
  it("renders conversation history above tool timeline in desktop column", () => {
    const source = readAssistantViewSource();
    const historyTitleIndex = source.indexOf("Conversation History");
    const toolTimelineIndex = source.indexOf("Tool Timeline");

    expect(historyTitleIndex).toBeGreaterThan(-1);
    expect(toolTimelineIndex).toBeGreaterThan(-1);
    expect(historyTitleIndex).toBeLessThan(toolTimelineIndex);
  });

  it("contains mobile conversations picker button and bottom sheet wiring", () => {
    const source = readAssistantViewSource();

    expect(source.includes(">Conversations<")).toBe(true);
    expect(source.includes("<v-bottom-sheet")).toBe(true);
    expect(source.includes("selectConversationFromPicker")).toBe(true);
    expect(source.includes("startNewConversationFromPicker")).toBe(true);
  });
});
