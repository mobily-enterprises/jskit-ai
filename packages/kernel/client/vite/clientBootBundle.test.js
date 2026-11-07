import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { createJskitClientBootstrapPlugin } from "./clientBootstrapPlugin.js";

const KERNEL_ROOT = fileURLToPath(new URL("../..", import.meta.url));

async function writeFixture(root, files) {
  for (const [name, source] of Object.entries(files)) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof source === "string" ? source : JSON.stringify(source));
  }
}

async function buildChunks(root) {
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const result = await build({
      root,
      configFile: false,
      logLevel: "silent",
      build: { write: false, minify: false, modulePreload: { polyfill: false } },
      plugins: [createJskitClientBootstrapPlugin()]
    });
    return (Array.isArray(result) ? result : [result])
      .flatMap(({ output }) => output)
      .filter(({ type }) => type === "chunk");
  } finally {
    process.chdir(previousCwd);
  }
}

test("the built bootstrap loads a package's provider without the screens its ./client re-exports", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-client-boot-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const screens = "node_modules/@example/screens";
  await writeFixture(root, {
    "package.json": { name: "client-boot-bundle-fixture", private: true, type: "module", dependencies: { "@example/screens": "1.0.0" } },
    "index.html": '<script type="module" src="/src/main.js"></script>',
    "src/main.js": 'import { bootInstalledClientModules } from "virtual:jskit-client-bootstrap";\nglobalThis.bootJskit = bootInstalledClientModules;\n',
    [`${screens}/package.json`]: {
      name: "@example/screens",
      version: "1.0.0",
      type: "module",
      exports: {
        "./client": "./src/client/index.js",
        "./client/providers/ScreensClientProvider": "./src/client/providers/ScreensClientProvider.js"
      },
      dependencies: { "image-editor": "1.0.0" },
      jskit: {
        kind: "runtime",
        runtime: { client: { providers: [{ entrypoint: "src/client/providers/ScreensClientProvider.js", export: "ScreensClientProvider" }] } }
      }
    },
    [`${screens}/src/client/index.js`]:
      'export { ScreensClientProvider } from "./providers/ScreensClientProvider.js";\n' +
      'export { default as SettingsScreen } from "./SettingsScreen.js";\n',
    [`${screens}/src/client/providers/ScreensClientProvider.js`]:
      'export const ScreensClientProvider = Object.freeze({ id: "screens.client.provider-in-boot", setup() {} });\n',
    // A settings screen's editor library, whose module runs code when it loads, as an editor or uploader does.
    [`${screens}/src/client/SettingsScreen.js`]:
      'import { openEditor } from "image-editor";\nexport default { name: "SettingsScreen", setup: () => openEditor };\n',
    "node_modules/image-editor/package.json": { name: "image-editor", version: "1.0.0", type: "module", exports: "./index.js" },
    "node_modules/image-editor/index.js":
      'globalThis.imageEditor = "image-editor-loaded-at-boot";\nexport function openEditor() { return globalThis.imageEditor; }\n'
  });
  await mkdir(path.join(root, "node_modules", "@jskit-ai"), { recursive: true });
  await symlink(KERNEL_ROOT, path.join(root, "node_modules", "@jskit-ai", "kernel"), "dir");

  const code = (await buildChunks(root)).map((chunk) => chunk.code).join("\n");

  assert.match(code, /screens\.client\.provider-in-boot/);
  assert.doesNotMatch(code, /image-editor-loaded-at-boot/);
  assert.doesNotMatch(code, /SettingsScreen/);
});
