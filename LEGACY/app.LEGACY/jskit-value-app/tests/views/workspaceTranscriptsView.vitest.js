import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readSource } from "../../../../tests/helpers/readSource.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const viewPath = path.join(rootDir, "src/views/workspace-transcripts/WorkspaceTranscriptsView.vue");
const logicPath = path.join(rootDir, "src/views/workspace-transcripts/useWorkspaceTranscriptsView.js");

describe("WorkspaceTranscriptsView", () => {
  it("imports and renders transcript explorer package element directly", () => {
    const source = readSource(viewPath);

    expect(source.includes('from "@jskit-ai/assistant-transcript-explorer-client-element/client"')).toBe(true);
    expect(source.includes("<AssistantTranscriptExplorerClientElement mode=\"workspace\" :meta=\"meta\" :state=\"state\" :actions=\"actions\" />")).toBe(
      true
    );
  });

  it("does not reintroduce inline transcript list/detail markup in the wrapper", () => {
    const source = readSource(viewPath);

    expect(source.includes("transcript-list")).toBe(false);
    expect(source.includes("transcript-timeline")).toBe(false);
  });

  it("provides actor formatting helper in view composable", () => {
    const source = readSource(logicPath);

    expect(source.includes("function formatConversationActor")).toBe(true);
    expect(source.includes("createdByUserDisplayName")).toBe(true);
    expect(source.includes("api.workspace.listMembers()")).toBe(true);
    expect(source.includes("memberUserFilter")).toBe(true);
    expect(source.includes("setMemberFilter")).toBe(true);
  });
});
