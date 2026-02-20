import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const viewPath = path.join(rootDir, "src/views/workspace-transcripts/WorkspaceTranscriptsView.vue");
const logicPath = path.join(rootDir, "src/views/workspace-transcripts/useWorkspaceTranscriptsView.js");

function readSource(filePath) {
  return readFileSync(filePath, "utf8");
}

describe("WorkspaceTranscriptsView", () => {
  it("shows actor metadata in transcript list subtitle", () => {
    const source = readSource(viewPath);

    expect(source.includes("meta.formatConversationActor(entry)")).toBe(true);
  });

  it("renders a user filter control for member-based transcript filtering", () => {
    const source = readSource(viewPath);

    expect(source.includes('label="User"')).toBe(true);
    expect(source.includes("state.memberFilterOptions")).toBe(true);
    expect(source.includes("actions.setMemberFilter")).toBe(true);
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
