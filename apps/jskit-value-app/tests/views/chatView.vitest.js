import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const chatViewPath = path.join(rootDir, "src/views/chat/ChatView.vue");

function readChatViewSource() {
  return readFileSync(chatViewPath, "utf8");
}

describe("ChatView template", () => {
  it("renders compact thread controls and secondary actions", () => {
    const source = readChatViewSource();

    expect(source.includes("Workspace room")).toBe(false);
    expect(source.includes("Start DM")).toBe(true);
    expect(source.includes("Workspace chat")).toBe(true);
    expect(source.includes("refreshCurrentThread")).toBe(true);
    expect(source.includes("workspaceChatPath")).toBe(false);
  });

  it("keeps message history controls and grouped rows", () => {
    const source = readChatViewSource();

    expect(source.includes("Load older history first, then continue chatting.")).toBe(false);
    expect(source.includes("Load older")).toBe(true);
    expect(source.includes("actions.loadOlderMessages")).toBe(true);
    expect(source.includes("state.messageRows")).toBe(true);
    expect(source.includes("state.composerError")).toBe(true);
    expect(source.includes("chat-message-bubble--composer-error")).toBe(true);
    expect(source.includes("chat-message-bubble")).toBe(true);
  });

  it("wires slim composer send flow with attachment controls and typing indicator", () => {
    const source = readChatViewSource();

    expect(source.includes("chat-composer-shell")).toBe(true);
    expect(source.includes("chat-composer-row")).toBe(true);
    expect(source.includes("chat-attach-icon")).toBe(true);
    expect(source.includes("actions.sendFromComposer")).toBe(true);
    expect(source.includes("actions.handleComposerKeydown")).toBe(true);
    expect(source.includes("actions.addComposerFiles")).toBe(true);
    expect(source.includes("actions.retryComposerAttachment")).toBe(true);
    expect(source.includes("actions.removeComposerAttachment")).toBe(true);
    expect(source.includes("state.typingNotice")).toBe(true);
  });

  it("keeps dm dialog wiring for candidate lookup and thread ensure", () => {
    const source = readChatViewSource();

    expect(source.includes("actions.refreshDmCandidates")).toBe(true);
    expect(source.includes("actions.ensureDmThread")).toBe(true);
    expect(source.includes("dmFilteredCandidates")).toBe(true);
  });
});
