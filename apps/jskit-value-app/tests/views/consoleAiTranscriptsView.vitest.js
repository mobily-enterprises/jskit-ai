import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readSource } from "../../../../tests/helpers/readSource.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const viewPath = path.join(rootDir, "src/views/console/ConsoleAiTranscriptsView.vue");

describe("ConsoleAiTranscriptsView", () => {
  it("imports and renders transcript explorer package element directly in console mode", () => {
    const source = readSource(viewPath);

    expect(source.includes('from "@jskit-ai/assistant-transcript-explorer-client-element"')).toBe(true);
    expect(source.includes("<AssistantTranscriptExplorerClientElement mode=\"console\" :meta=\"meta\" :state=\"state\" :actions=\"actions\" />")).toBe(true);
  });

  it("does not contain inline transcript explorer markup", () => {
    const source = readSource(viewPath);

    expect(source.includes("transcript-list")).toBe(false);
    expect(source.includes("transcript-timeline")).toBe(false);
  });
});
