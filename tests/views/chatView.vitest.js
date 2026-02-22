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
  it("renders load-more controls for threads and messages", () => {
    const source = readChatViewSource();
    const matches = source.match(/Load more/g) || [];

    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(source.includes("actions.loadMoreThreads")).toBe(true);
    expect(source.includes("actions.loadOlderMessages")).toBe(true);
  });

  it("wires composer send action and deterministic status/error alerts", () => {
    const source = readChatViewSource();

    expect(source.includes("actions.sendFromComposer")).toBe(true);
    expect(source.includes("state.sendStatus")).toBe(true);
    expect(source.includes("state.actionError")).toBe(true);
    expect(source.includes("state.inboxError")).toBe(true);
    expect(source.includes("state.messagesError")).toBe(true);
  });
});
