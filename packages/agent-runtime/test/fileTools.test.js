import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileTools } from "../src/server/index.js";

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-files-"));
  await mkdir(path.join(root, "src", "lib"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "dep"), { recursive: true });
  await writeFile(path.join(root, "src", "main.js"), "import { add } from \"./lib/math.js\";\nconsole.log(add(2, 3));\n");
  await writeFile(path.join(root, "src", "lib", "math.js"), "export function add(a, b) {\n  return a + b;\n}\n");
  await writeFile(path.join(root, "node_modules", "dep", "index.js"), "export function add() {}\n");
  return { root, tools: fileTools({ root }) };
}

test("the file tools list, find, search, read, write and edit inside the workspace", async () => {
  const { root, tools } = await workspace();
  const listed = await tools.listFiles.execute({ depth: 3 });
  assert.deepEqual(listed.entries, ["node_modules/", "src/", "src/lib/", "src/lib/math.js", "src/main.js"], "node_modules is listed, never gone through");
  assert.deepEqual((await tools.findFiles.execute({ pattern: "**/*.js" })).files.sort(), ["src/lib/math.js", "src/main.js"]);
  const found = await tools.search.execute({ pattern: "function add" });
  assert.match(found.matches, /src\/lib\/math\.js:1:export function add/u);
  assert.doesNotMatch(found.matches, /node_modules/u);
  assert.equal((await tools.search.execute({ pattern: "nowhere-to-be-found" })).note, "Nothing matches.");
  assert.match((await tools.readFile.execute({ path: "src/lib/math.js" })).text, /return a \+ b;/u);
  assert.equal((await tools.writeFile.execute({ path: "src/new/util.js", content: "export const one = 1;\n" })).status, "written");
  assert.equal(await readFile(path.join(root, "src", "new", "util.js"), "utf8"), "export const one = 1;\n");
  assert.equal((await tools.editFile.execute({ path: "src/lib/math.js", old_text: "a + b", new_text: "a + b + 0" })).status, "edited");
  assert.match(await readFile(path.join(root, "src", "lib", "math.js"), "utf8"), /a \+ b \+ 0/u);
});

test("an edit must match exactly once, unless every match is meant", async () => {
  const { tools } = await workspace();
  await tools.writeFile.execute({ path: "twice.txt", content: "x = 1\nx = 1\n" });
  assert.match((await tools.editFile.execute({ path: "twice.txt", old_text: "y = 2", new_text: "z" })).error, /isn't in the file/u);
  assert.match((await tools.editFile.execute({ path: "twice.txt", old_text: "x = 1", new_text: "x = 2" })).error, /appears 2 times/u);
  assert.equal((await tools.editFile.execute({ path: "twice.txt", old_text: "x = 1", new_text: "x = 2", replace_all: true })).replaced, 2);
});

test("nothing outside the workspace can be read or written, links included", async () => {
  const { root, tools } = await workspace();
  const outside = await mkdtemp(path.join(os.tmpdir(), "agent-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await symlink(outside, path.join(root, "escape"));
  for (const wanted of ["../secret.txt", path.join(outside, "secret.txt"), "escape/secret.txt"]) {
    assert.match((await tools.readFile.execute({ path: wanted })).error, /outside the workspace/u, wanted);
  }
  assert.match((await tools.writeFile.execute({ path: "escape/new.txt", content: "x" })).error, /outside the workspace/u);
  assert.match((await tools.listFiles.execute({ path: ".." })).error, /outside the workspace/u);
});

test("binary files aren't read as text", async () => {
  const { root, tools } = await workspace();
  await writeFile(path.join(root, "image.bin"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  assert.equal((await tools.readFile.execute({ path: "image.bin" })).error, "This file isn't text.");
});
