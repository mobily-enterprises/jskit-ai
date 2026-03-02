import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const profileFormPath = path.join(rootDir, "src/views/settings/profile/SettingsProfileForm.vue");

function readProfileFormSource() {
  return readFileSync(profileFormPath, "utf8");
}

describe("SettingsProfileForm wrapper", () => {
  it("imports and renders ProfileClientElement directly", () => {
    const source = readProfileFormSource();

    expect(source.includes('from "@jskit-ai/profile-client-element/client"')).toBe(true);
    expect(source.includes("<ProfileClientElement :state=\"state\" :actions=\"actions\" />")).toBe(true);
  });

  it("removes package-owned profile markup from app wrapper", () => {
    const source = readProfileFormSource();

    expect(source.includes("Replace avatar")).toBe(false);
    expect(source.includes("Save profile")).toBe(false);
    expect(source.includes("v-form")).toBe(false);
  });
});
