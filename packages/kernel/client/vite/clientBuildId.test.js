import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "vite";
import { createJskitClientBootstrapPlugin } from "./clientBootstrapPlugin.js";
import { clientBuildIdFromHtml, pageClientBuildId } from "../../shared/support/clientBuild.js";
import { readServedClientBuildId } from "../../server/support/clientBuild.js";

async function writeFixture(root, files) {
  for (const [name, source] of Object.entries(files)) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }
}

async function buildFixture(root) {
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [createJskitClientBootstrapPlugin()]
    });
  } finally {
    process.chdir(previousCwd);
  }
  return readFile(path.join(root, "dist", "index.html"), "utf8");
}

test("every built page names its build, which changes exactly when the built code or styles change", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-client-build-id-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFixture(root, {
    "package.json": JSON.stringify({ name: "client-build-fixture", private: true, type: "module" }),
    "favicon.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
    "index.html": '<!doctype html><html><head><link rel="icon" href="/favicon.svg"><title>Fixture</title></head>' +
      '<body><script type="module" src="/src/main.js"></script></body></html>',
    "src/main.js": 'import "./main.css"; document.body.onclick = () => import("./page.js").then((page) => page.show());',
    "src/main.css": "body { color: black; }",
    "src/page.js": 'import "./page.css"; export const show = () => console.log("first");',
    "src/page.css": ".page { color: blue; }"
  });

  const first = clientBuildIdFromHtml(await buildFixture(root));
  assert.match(first, /^[0-9a-f]{16}$/u, "the built page names its build");
  assert.equal(await readServedClientBuildId({ appRoot: root }), first, "the server reads the build it serves");
  assert.equal(clientBuildIdFromHtml(await buildFixture(root)), first, "the same source builds the same id");

  await writeFile(path.join(root, "src/page.js"), 'import "./page.css"; export const show = () => console.log("second");');
  const lazyCode = clientBuildIdFromHtml(await buildFixture(root));
  assert.notEqual(lazyCode, first, "code loaded later still changes the build");

  await writeFile(path.join(root, "src/page.css"), ".page { color: red; }");
  const lazyStyle = clientBuildIdFromHtml(await buildFixture(root));
  assert.notEqual(lazyStyle, lazyCode, "styles loaded later still change the build");

  await writeFile(path.join(root, "src/main.css"), "body { color: white; }");
  assert.notEqual(clientBuildIdFromHtml(await buildFixture(root)), lazyStyle, "the page's own styles change the build");
});

test("development pages and missing builds have no build id", async (t) => {
  const plugin = createJskitClientBootstrapPlugin();
  const html = "<html><head></head><body></body></html>";
  assert.equal(plugin.transformIndexHtml.handler(html, { server: {} }), undefined);

  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-client-build-id-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await readServedClientBuildId({ appRoot: root }), "");
  await assert.rejects(readServedClientBuildId({}), /requires appRoot/u);
});

test("a page reads the build it loaded from its own document", () => {
  const documentObject = {
    querySelector(selector) {
      assert.equal(selector, 'meta[name="jskit-client-build"]');
      return { getAttribute: (name) => (name === "content" ? "0123456789abcdef" : null) };
    }
  };
  assert.equal(pageClientBuildId(documentObject), "0123456789abcdef");
  assert.equal(pageClientBuildId({ querySelector: () => null }), "");
  assert.equal(pageClientBuildId(undefined), "");
});
