import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const assistantViewPath = path.join(rootDir, "src/views/assistant/AssistantView.vue");

function readAssistantViewSource() {
  return readFileSync(assistantViewPath, "utf8");
}

describe("AssistantView wrapper", () => {
  it("imports and renders AssistantClientElement directly", () => {
    const source = readAssistantViewSource();

    expect(source.includes('from "@jskit-ai/assistant-client-element"')).toBe(true);
    expect(source.includes("<AssistantClientElement :meta=\"meta\" :state=\"state\" :actions=\"actions\" :viewer=\"viewer\" />")).toBe(
      true
    );
  });

  it("keeps thin wrapper behavior with viewer mapping and no package-owned markup", () => {
    const source = readAssistantViewSource();

    expect(source.includes("profileDisplayName")).toBe(true);
    expect(source.includes("assistant-history-card")).toBe(false);
    expect(source.includes("Conversation History")).toBe(false);
    expect(source.includes("Tool Timeline")).toBe(false);
  });
});
