import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runJskit } from "../../packages/tooling/testUtils/runJskit.mjs";

async function writeJsonFile(absolutePath, value) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "stage12-cutover-"));
  try {
    await writeJsonFile(path.join(appRoot, "package.json"), {
      name: "stage12-cutover-app",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        start: "jskit-app-scripts start"
      },
      dependencies: {
        "@jskit-ai/app-scripts": "0.1.0",
        fastify: "^5.7.4",
        vue: "^3.5.13"
      },
      devDependencies: {
        "@jskit-ai/config-eslint": "0.1.0",
        eslint: "^9.39.1",
        vite: "^6.1.0",
        vitest: "^4.0.18"
      }
    });
    await writeFile(path.join(appRoot, "Procfile"), "web: npm run start\n", "utf8");
    await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

test("pre-cut legacy manifest is blocked and migration path restores doctor clean state", async () => {
  await withTempApp(async (appRoot) => {
    await mkdir(path.join(appRoot, "framework"), { recursive: true });
    await writeFile(
      path.join(appRoot, "framework/app.manifest.mjs"),
      "export default Object.freeze({ manifestVersion: 1, profileId: 'web-saas-default' });\n",
      "utf8"
    );

    const doctorBefore = runJskit({
      cwd: appRoot,
      args: ["doctor"]
    });
    assert.notEqual(doctorBefore.status, 0);
    assert.match(doctorBefore.stdout + doctorBefore.stderr, /\[legacy-surface\]/);

    await rm(path.join(appRoot, "framework"), { recursive: true, force: true });

    const addDb = runJskit({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    const doctorAfter = runJskit({
      cwd: appRoot,
      args: ["doctor"]
    });
    assert.equal(doctorAfter.status, 0, doctorAfter.stderr);
  });
});
