import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "vite";
import {
  VUETIFY_LAYER_ORDER,
  checkVuetifyLayerOrder,
  createJskitClientBootstrapPlugin,
  namedCascadeLayers
} from "./clientBootstrapPlugin.js";
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

// A build links the stylesheets of shared component chunks, each opening with @layer vuetify-components, before the
// entry's vuetify/styles; the page names Vuetify's layer order before all of them.
test("a built page declares Vuetify's layer order before any stylesheet", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-client-layer-order-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFixture(root, {
    "package.json": JSON.stringify({ name: "client-layer-order-fixture", private: true, type: "module" }),
    "index.html": '<!doctype html><html><head><meta charset="UTF-8"><title>Fixture</title>' +
      '<link rel="stylesheet" href="/src/chunk.css"></head><body><script type="module" src="/src/main.js"></script></body></html>',
    "src/chunk.css": "@layer vuetify-components { .v-btn { font-weight: 500; } }",
    "src/main.js": 'import "./main.css";',
    "src/main.css": "@layer vuetify-core { @layer reset { button { font: inherit; } } }"
  });
  const head = /<head>([\s\S]*?)<\/head>/u.exec(await buildFixture(root))[1];
  const declared = head.indexOf(`<style>${VUETIFY_LAYER_ORDER}</style>`);
  assert.ok(declared >= 0, "the page declares the layer order");
  const stylesheets = [...head.matchAll(/<link\b[^>]*\brel="stylesheet"|<style\b/gu)].map(({ index }) => index);
  assert.ok(stylesheets.length > 1, "the build links its stylesheets");
  assert.equal(Math.min(...stylesheets), declared, "nothing styles the page before the layer order");
});

// The order is Vuetify's own: its layers.css, every sublayer in place.
test("the declared layer order is the installed Vuetify's", async () => {
  const source = await readFile(new URL("../../../../node_modules/vuetify/lib/styles/layers.css", import.meta.url), "utf8");
  assert.deepEqual([...new Set(namedCascadeLayers(VUETIFY_LAYER_ORDER))], [...new Set(namedCascadeLayers(source))]);
});

// The build checks its own output: what a page's stylesheets, in page order, make of Vuetify's layers.
test("the layer order check reads stylesheets as the browser does", () => {
  assert.deepEqual(namedCascadeLayers("@media (min-width: 1px) { @layer vuetify-core { @layer reset, base; .a { b: c; } } }" +
    " @layer vuetify-final.trumps { .d { e: f; } }"), [
    "vuetify-core", "vuetify-core.reset", "vuetify-core.base", "vuetify-final", "vuetify-final.trumps"
  ]);
  assert.equal(checkVuetifyLayerOrder([VUETIFY_LAYER_ORDER, "@layer vuetify-components{.v-btn{font-weight:500}}"]), "");
  // A component chunk linked before vuetify/styles, with nothing naming the order first.
  assert.match(checkVuetifyLayerOrder(["@layer vuetify-components{.v-btn{font-weight:500}}",
    "@layer vuetify-core{@layer reset,base;}"]), /order vuetify-components, vuetify-core,/u);
  // A layer a newer Vuetify adds lands after all the declared ones.
  assert.match(checkVuetifyLayerOrder([VUETIFY_LAYER_ORDER, "@layer vuetify-labs{.x{y:z}}"]), /vuetify-final\.trumps, vuetify-labs;/u);
});

test("a build whose page would put Vuetify's layers out of order fails", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-client-layer-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFixture(root, {
    "package.json": JSON.stringify({ name: "client-layer-check-fixture", private: true, type: "module" }),
    "index.html": '<!doctype html><html><head><title>Fixture</title></head>' +
      '<body><script type="module" src="/src/main.js"></script></body></html>',
    "src/main.js": 'import "./main.css";',
    "src/main.css": "@layer vuetify-labs { .x { color: red; } }"
  });
  await assert.rejects(buildFixture(root), /index\.html: The built page puts Vuetify's cascade layers in the order/u);
});

test("development pages and missing builds have no build id", async (t) => {
  const plugin = createJskitClientBootstrapPlugin();
  const html = "<html><head></head><body></body></html>";
  const served = plugin.transformIndexHtml.handler(html, { server: {} });
  assert.deepEqual(served.map(({ tag }) => tag), ["style", "meta"], "the layer order and the side-effects setting");
  assert.equal(served.some(({ attrs }) => attrs?.name === "jskit-client-build"), false, "no build id");

  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-client-build-id-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await readServedClientBuildId({ appRoot: root }), "");
  await assert.rejects(readServedClientBuildId({}), /requires appRoot/u);
});

test("a development page names the development server's SIDE_EFFECTS, simulating unless it is exactly live", (t) => {
  const plugin = createJskitClientBootstrapPlugin();
  const saved = process.env.SIDE_EFFECTS;
  t.after(() => {
    if (saved === undefined) {
      delete process.env.SIDE_EFFECTS;
    } else {
      process.env.SIDE_EFFECTS = saved;
    }
  });
  const sideEffects = () => plugin.transformIndexHtml.handler("<html><head></head></html>", { server: {} })
    .find(({ attrs }) => attrs?.name === "jskit-side-effects")?.attrs.content;
  delete process.env.SIDE_EFFECTS;
  assert.equal(sideEffects(), "simulate", "unset simulates");
  process.env.SIDE_EFFECTS = "LIVE";
  assert.equal(sideEffects(), "simulate", "only exactly live is live");
  process.env.SIDE_EFFECTS = "live";
  assert.equal(sideEffects(), "live");
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
