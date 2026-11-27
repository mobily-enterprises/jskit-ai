import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { checkAgentsBlock, formatAgentsBlockReport } from "../scripts/agents-block.mjs";
import { parseArgs } from "../scripts/jskit.mjs";

const CLI_PATH = fileURLToPath(new URL("../scripts/jskit.mjs", import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CATALOG = "@jskit-ai/jskit-catalog";
const BEGIN = "<!-- jskit:begin app guidance (written by npx jskit agents; edit outside this block) -->";
const END = "<!-- jskit:end app guidance -->";
const execFileAsync = promisify(execFile);

async function catalogBlock() {
  const [source, manifest] = await Promise.all([
    readFile(path.join(PACKAGE_ROOT, "app-guidance", "AGENTS.block.md"), "utf8"),
    readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8")
  ]);
  return { block: `${BEGIN}\n${source}${END}`, version: JSON.parse(manifest).version };
}

async function withApp(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-agents-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const cli = (args) => execFileAsync(process.execPath, [CLI_PATH, ...args]).then(
  ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
  (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr })
);
const agentsFile = (root) => readFile(path.join(root, "AGENTS.md"), "utf8");

test("the published catalog ships the block jskit agents writes", async () => {
  const manifest = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
  assert.ok(manifest.files.includes("app-guidance"), manifest.files.join(", "));
});

test("jskit agents writes the catalog's block into a new AGENTS.md, at the top of one without it, and in place", async () => {
  const { block, version } = await catalogBlock();
  await withApp({}, async (root) => {
    const made = await cli(["agents", "--root", root]);
    assert.equal(made.code, 0, made.stderr);
    assert.equal(made.stdout, `Wrote the JSKIT block of ${CATALOG} ${version} in a new AGENTS.md. Commit AGENTS.md.\n`);
    assert.equal(await agentsFile(root), `${block}\n`);
  });
  const own = "# Reading room\n\nOwn rule: shelves are sorted by author.\n";
  await withApp({ "AGENTS.md": own }, async (root) => {
    const top = await cli(["agents", "--root", root]);
    assert.equal(top.stdout, `Wrote the JSKIT block of ${CATALOG} ${version} at the top of AGENTS.md. Commit AGENTS.md.\n`);
    assert.equal(await agentsFile(root), `${block}\n\n${own}`);
  });
  const around = (inside) => `# Reading room\n\n${inside}\n\nOwn rule: shelves are sorted by author.\n`;
  await withApp({ "AGENTS.md": around(`${BEGIN}\nAn older release's text.\n${END}`) }, async (root) => {
    const replaced = await cli(["agents", "--root", root]);
    assert.equal(replaced.stdout, `Wrote the JSKIT block of ${CATALOG} ${version} in AGENTS.md, between its markers. Commit AGENTS.md.\n`);
    assert.equal(await agentsFile(root), around(block));
    const again = await cli(["agents", "--root", root]);
    assert.equal(again.stdout, `AGENTS.md already carries the JSKIT block of ${CATALOG} ${version}.\n`);
    assert.equal(await agentsFile(root), around(block));
  });
});

test("jskit agents refuses markers that are not one pair, the begin marker first, and writes nothing", async () => {
  for (const [text, says] of [
    [`${BEGIN}\nOne.\n${END}\n${BEGIN}\nTwo.\n${END}\n`, "AGENTS.md has 2 JSKIT begin marker(s) and 2 end marker(s)"],
    [`${END}\nOwn rule.\n${BEGIN}\n`, "AGENTS.md has 1 JSKIT begin marker(s) and 1 end marker(s), the end first"],
    [`${BEGIN}\nOwn rule.\n`, "AGENTS.md has 1 JSKIT begin marker(s) and 0 end marker(s)"]
  ]) {
    await withApp({ "AGENTS.md": text }, async (root) => {
      const refused = await cli(["agents", "--root", root]);
      assert.equal(refused.code, 1);
      assert.equal(refused.stderr, `${says}; leave one pair, the begin marker first, or none, and run npx jskit agents again.\n`);
      assert.equal(await agentsFile(root), text);
    });
  }
});

test("jskit check fails an app that declares the catalog without its block or with the block changed (agents/jskit-block)", async () => {
  const { block, version } = await catalogBlock();
  const manifest = { name: "reading-room", private: true, devDependencies: { [CATALOG]: version } };
  const fix = "run `npx jskit agents` and commit AGENTS.md.";
  const lacks = `AGENTS.md lacks the JSKIT block of ${CATALOG} ${version}: ${fix}`;
  const differs = `AGENTS.md's JSKIT block differs from ${CATALOG} ${version}'s: ${fix}`;
  const link = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#agent-instructions";
  await withApp({ "package.json": manifest }, async (root) => {
    const missing = await cli(["check", "--root", root]);
    assert.equal(missing.code, 1);
    assert.ok(missing.stderr.includes(`\nAGENTS.md  agents/jskit-block  ${lacks}\n  ${link}\nJSKIT agent instructions: 1 error.`), missing.stderr);
    const report = async (text) => {
      await writeFile(path.join(root, "AGENTS.md"), text);
      return formatAgentsBlockReport(await checkAgentsBlock({ projectRoot: root }));
    };
    assert.equal(await report("# Reading room\n"), `AGENTS.md  agents/jskit-block  ${lacks}\n  ${link}\nJSKIT agent instructions: 1 error.`);
    const changed = `AGENTS.md  agents/jskit-block  ${differs}\n  ${link}\nJSKIT agent instructions: 1 error.`;
    assert.equal(await report(`# Reading room\n\n${block.replace("Never install", "Avoid installing")}\n`), changed);
    assert.equal(await report(`${BEGIN}\n${END}\n${block}\n`), changed);
    // The app's own text around the block is its own.
    assert.equal(
      await report(`# Reading room\n\n${block}\n\nOwn rule: shelves are sorted by author.\n`),
      `JSKIT agent instructions: AGENTS.md carries the JSKIT block of ${CATALOG} ${version}.`
    );
  });
});

// A project that does not declare the catalog pins no version, so no block is its own.
test("jskit check leaves AGENTS.md alone in a project that does not declare the catalog", async () => {
  await withApp({ "package.json": { name: "tool", private: true } }, async (root) => {
    assert.equal(
      formatAgentsBlockReport(await checkAgentsBlock({ projectRoot: root })),
      "JSKIT agent instructions: not checked, as package.json does not declare @jskit-ai/jskit-catalog."
    );
  });
});

test("jskit agents takes only --root", () => {
  assert.deepEqual(parseArgs(["agents", "--root", "/tmp/example"]), { command: "agents", projectRoot: "/tmp/example" });
  assert.throws(() => parseArgs(["agents", "--manifest", "a/package.json"]), /only valid with jskit update and jskit check/u);
  assert.throws(() => parseArgs(["agents", "--no-install"]), /only valid with jskit update/u);
  assert.throws(() => parseArgs(["agents", "AGENTS.md"]), /Unknown argument: AGENTS\.md/u);
});
