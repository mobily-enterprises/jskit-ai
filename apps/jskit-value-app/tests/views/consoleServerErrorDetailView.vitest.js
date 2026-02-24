import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const viewPath = path.join(rootDir, "src/views/console/ConsoleServerErrorDetailView.vue");

describe("ConsoleServerErrorDetailView", () => {
  it("renders console error detail package component in server mode", () => {
    const source = readFileSync(viewPath, "utf8");

    expect(source.includes('from "@jskit-ai/console-errors-client-element"')).toBe(true);
    expect(source.includes('<ConsoleErrorDetailClientElement mode="server" :meta="meta" :state="state" :actions="actions" />')).toBe(true);
  });
});
