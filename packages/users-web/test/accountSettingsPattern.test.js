import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The users/account-settings pattern lays its sections out as pages: the section list at the account surface's "/",
// an inner page of home, and one section at "/<section>", whose parent is the list, both rendering the element.
const PAGES = new URL("../patterns/account-settings/example/src/pages/", import.meta.url);

async function routeMeta(file) {
  const source = await readFile(new URL(file, PAGES), "utf8");
  const block = /<route lang="json">([\s\S]*?)<\/route>/u.exec(source);
  assert.ok(block, `${file} declares its route meta`);
  assert.match(source, /<AccountSettingsClientElement \/>/u, `${file} renders AccountSettingsClientElement`);
  return JSON.parse(block[1]).meta;
}

test("the account-settings pattern's list and section pages declare their parents", async () => {
  const list = await routeMeta("account/index.vue");
  assert.deepEqual(list.jskit.parent, { surface: "home", path: "/" });
  const section = await routeMeta("account/[section].vue");
  assert.equal(section.jskit.parent, "/");
  assert.deepEqual(section.guard, list.guard);
  assert.equal(section.jskit.title, list.jskit.title);
});
