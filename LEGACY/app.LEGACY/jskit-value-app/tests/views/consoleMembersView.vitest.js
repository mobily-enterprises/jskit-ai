import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readSource } from "../../../../tests/helpers/readSource.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const viewPath = path.join(rootDir, "src/views/console/ConsoleMembersView.vue");

describe("ConsoleMembersView", () => {
  it("imports and renders members admin package element in console mode", () => {
    const source = readSource(viewPath);

    expect(source.includes('from "@jskit-ai/members-admin-client-element/client"')).toBe(true);
    expect(source.includes('<MembersAdminClientElement')).toBe(true);
    expect(source.includes('mode="console"')).toBe(true);
  });

  it("does not contain inline members/invites list markup", () => {
    const source = readSource(viewPath);

    expect(source.includes('label="Email"')).toBe(false);
    expect(source.includes("Pending invites")).toBe(false);
    expect(source.includes("member-role-select")).toBe(false);
  });
});
