import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const chatViewPath = path.join(rootDir, "src/views/chat/ChatView.vue");

function readChatViewSource() {
  return readFileSync(chatViewPath, "utf8");
}

describe("ChatView wrapper", () => {
  it("imports and renders ChatClientElement directly", () => {
    const source = readChatViewSource();

    expect(source.includes('from "@jskit-ai/chat-client-element/client"')).toBe(true);
    expect(source.includes("<ChatClientElement :meta=\"meta\" :state=\"state\" :helpers=\"helpers\" :actions=\"actions\" />")).toBe(
      true
    );
  });

  it("removes package-owned chat markup from app wrapper", () => {
    const source = readChatViewSource();

    expect(source.includes("chat-message-panel")).toBe(false);
    expect(source.includes("chat-composer-shell")).toBe(false);
    expect(source.includes("Start DM")).toBe(false);
    expect(source.includes("Load older")).toBe(false);
  });
});
