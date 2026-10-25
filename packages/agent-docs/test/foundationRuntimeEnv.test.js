import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PATTERNS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "patterns");

async function resolvePortIn(patternName, workingDirectory) {
  const moduleUrl = pathToFileURL(
    path.join(PATTERNS_ROOT, patternName, "example", "server", "lib", "runtimeEnv.js")
  ).href;
  const environment = { ...process.env };
  delete environment.PORT;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", `
    const { resolveRuntimeEnv } = await import(${JSON.stringify(moduleUrl)});
    console.log(resolveRuntimeEnv().PORT);
  `], { cwd: workingDirectory, env: environment });
  return Number(stdout.trim());
}

test("application foundations load .env with the Node runtime and run without one", async (t) => {
  const withEnv = await mkdtemp(path.join(os.tmpdir(), "jskit-foundation-env-"));
  const withoutEnv = await mkdtemp(path.join(os.tmpdir(), "jskit-foundation-no-env-"));
  t.after(() => Promise.all([
    rm(withEnv, { recursive: true, force: true }),
    rm(withoutEnv, { recursive: true, force: true })
  ]));
  await writeFile(path.join(withEnv, ".env"), "PORT=4567\n", "utf8");

  for (const patternName of ["minimal-foundation", "shell-foundation"]) {
    assert.equal(await resolvePortIn(patternName, withEnv), 4567);
    assert.equal(await resolvePortIn(patternName, withoutEnv), 3000);
  }
});
