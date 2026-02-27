import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli as runCreateAppCli } from "../src/shared/index.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit-create-app.js", import.meta.url));
const JSKIT_CLI_PATH = fileURLToPath(new URL("../../jskit/bin/jskit.js", import.meta.url));

function runCli({ cwd, args = [], input = undefined }) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    input
  });
}

function runJskit({ cwd, args = [] }) {
  return spawnSync(process.execPath, [JSKIT_CLI_PATH, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function createCaptureWritable() {
  let body = "";
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        body += chunk.toString("utf8");
        callback();
      }
    }),
    read() {
      return body;
    }
  };
}

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "jskit-create-app-"));
  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("create-app scaffolds the base shell with placeholder replacements", async () => {
  await withTempDir(async (cwd) => {
    const result = runCli({ cwd, args: ["sample-app"] });

    assert.equal(result.status, 0, result.stderr);

    const appRoot = path.join(cwd, "sample-app");
    const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(packageJson.name, "sample-app");

    const readme = await readFile(path.join(appRoot, "README.md"), "utf8");
    assert.match(readme, /^# Sample App$/m);
    assert.match(readme, /npm run dev/);
    assert.doesNotMatch(readme, /-w apps/);

    const gitignore = await readFile(path.join(appRoot, ".gitignore"), "utf8");
    assert.match(gitignore, /node_modules\//);

    const indexHtml = await readFile(path.join(appRoot, "index.html"), "utf8");
    assert.match(indexHtml, /<title>Sample App<\/title>/);
    assert.match(indexHtml, /href="\/favicon\.svg"/);

    const favicon = await readFile(path.join(appRoot, "favicon.svg"), "utf8");
    assert.match(favicon, /<svg/);

    const serverSmoke = await readFile(path.join(appRoot, "tests/server/smoke.test.js"), "utf8");
    assert.match(serverSmoke, /app: "sample-app"/);

    const clientSmoke = await readFile(path.join(appRoot, "tests/client/smoke.vitest.js"), "utf8");
    assert.match(clientSmoke, /sample-app client smoke/);

    assert.match(result.stdout, /npx jskit add db --provider mysql --no-install/);
    assert.match(result.stdout, /npx jskit add auth-base --no-install/);
  });
});

test("create-app interactive flow captures initial bundle selection in guidance", async () => {
  await withTempDir(async (cwd) => {
    const stdoutCapture = createCaptureWritable();
    const stderrCapture = createCaptureWritable();
    const answers = [
      "interactive-app",
      "",
      "",
      "",
      "",
      "db-auth",
      "postgres"
    ];
    const askedPrompts = [];
    const readlineFactory = () => ({
      async question(prompt) {
        askedPrompts.push(prompt);
        const answer = answers.shift();
        if (answer === undefined) {
          throw new Error(`Unexpected prompt without answer: ${prompt}`);
        }
        return answer;
      },
      close() {}
    });

    const exitCode = await runCreateAppCli(["--interactive"], {
      cwd,
      stdout: stdoutCapture.stream,
      stderr: stderrCapture.stream,
      readlineFactory
    });

    const stdout = stdoutCapture.read();
    const stderr = stderrCapture.read();
    assert.equal(exitCode, 0, stderr);
    assert.deepEqual(answers, []);
    assert.ok(askedPrompts.length >= 7);
    assert.match(stdout, /Initial framework bundle commands \(db-auth\):/);
    assert.match(stdout, /npx jskit add db --provider postgres --no-install/);
    assert.match(stdout, /npx jskit add auth-base --no-install/);
  });
});

test("create-app refuses non-empty target directory without --force", async () => {
  await withTempDir(async (cwd) => {
    const targetDirectory = path.join(cwd, "existing-app");
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(path.join(targetDirectory, "keep.txt"), "keep\n", "utf8");

    const result = runCli({
      cwd,
      args: ["my-app", "--target", "existing-app"]
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Target directory is not empty/);

    const persisted = await readFile(path.join(targetDirectory, "keep.txt"), "utf8");
    assert.equal(persisted, "keep\n");
  });
});

test("create-app allows target directory that only contains .git", async () => {
  await withTempDir(async (cwd) => {
    const targetDirectory = path.join(cwd, "existing-app");
    await mkdir(path.join(targetDirectory, ".git"), { recursive: true });

    const result = runCli({
      cwd,
      args: ["git-only-app", "--target", "existing-app"]
    });

    assert.equal(result.status, 0, result.stderr);

    const packageJson = JSON.parse(await readFile(path.join(targetDirectory, "package.json"), "utf8"));
    assert.equal(packageJson.name, "git-only-app");
  });
});

test("create-app dry-run prints plan and does not write files", async () => {
  await withTempDir(async (cwd) => {
    const result = runCli({ cwd, args: ["dry-run-app", "--dry-run"] });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[dry-run\]/);

    await assert.rejects(access(path.join(cwd, "dry-run-app")), /ENOENT/);
  });
});

test("create-app allows non-empty target when --force is passed", async () => {
  await withTempDir(async (cwd) => {
    const targetDirectory = path.join(cwd, "existing-app");
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(path.join(targetDirectory, "notes.txt"), "preserve\n", "utf8");

    const result = runCli({
      cwd,
      args: ["forced-app", "--target", "existing-app", "--force"]
    });

    assert.equal(result.status, 0, result.stderr);

    const packageJson = JSON.parse(await readFile(path.join(targetDirectory, "package.json"), "utf8"));
    assert.equal(packageJson.name, "forced-app");

    const notes = await readFile(path.join(targetDirectory, "notes.txt"), "utf8");
    assert.equal(notes, "preserve\n");
  });
});

test("create-app applies explicit app title when --title is provided", async () => {
  await withTempDir(async (cwd) => {
    const result = runCli({
      cwd,
      args: ["title-app", "--title", "Acme Starter"]
    });

    assert.equal(result.status, 0, result.stderr);

    const appRoot = path.join(cwd, "title-app");

    const readme = await readFile(path.join(appRoot, "README.md"), "utf8");
    assert.match(readme, /^# Acme Starter$/m);

    const indexHtml = await readFile(path.join(appRoot, "index.html"), "utf8");
    assert.match(indexHtml, /<title>Acme Starter<\/title>/);

    const mainJs = await readFile(path.join(appRoot, "src/main.js"), "utf8");
    assert.match(mainJs, /<h1>Acme Starter<\/h1>/);
  });
});

test("generated shell-only app passes jskit doctor and keeps minimal Procfile", async () => {
  await withTempDir(async (cwd) => {
    const createResult = runCli({ cwd, args: ["shell-only-app"] });
    assert.equal(createResult.status, 0, createResult.stderr);

    const appRoot = path.join(cwd, "shell-only-app");
    const doctorResult = runJskit({ cwd: appRoot, args: ["doctor"] });
    assert.equal(doctorResult.status, 0, doctorResult.stderr);

    const procfile = await readFile(path.join(appRoot, "Procfile"), "utf8");
    assert.equal(procfile, "web: npm run start\n");
    await assert.rejects(access(path.join(appRoot, "framework")), /ENOENT/);
  });
});

test("generated app supports shell + db progressive installation", async () => {
  await withTempDir(async (cwd) => {
    const createResult = runCli({ cwd, args: ["shell-db-app"] });
    assert.equal(createResult.status, 0, createResult.stderr);

    const appRoot = path.join(cwd, "shell-db-app");
    const addDbResult = runJskit({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });
    assert.equal(addDbResult.status, 0, addDbResult.stderr);

    const doctorResult = runJskit({ cwd: appRoot, args: ["doctor"] });
    assert.equal(doctorResult.status, 0, doctorResult.stderr);

    const procfile = await readFile(path.join(appRoot, "Procfile"), "utf8");
    assert.match(procfile, /^release: npm run db:migrate$/m);
    assert.match(procfile, /^web: npm run start$/m);
  });
});

test("generated app supports shell + db + auth progressive installation", async () => {
  await withTempDir(async (cwd) => {
    const createResult = runCli({ cwd, args: ["shell-db-auth-app"] });
    assert.equal(createResult.status, 0, createResult.stderr);

    const appRoot = path.join(cwd, "shell-db-auth-app");
    const addDbResult = runJskit({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });
    assert.equal(addDbResult.status, 0, addDbResult.stderr);

    const addAuthResult = runJskit({
      cwd: appRoot,
      args: ["add", "auth-base", "--no-install"]
    });
    assert.equal(addAuthResult.status, 0, addAuthResult.stderr);

    const doctorResult = runJskit({ cwd: appRoot, args: ["doctor"] });
    assert.equal(doctorResult.status, 0, doctorResult.stderr);

    const lockfile = JSON.parse(await readFile(path.join(appRoot, ".jskit/lock.json"), "utf8"));
    assert.ok(lockfile.installedPacks["auth-base"]);
    assert.ok(lockfile.installedPackages["@jskit-ai/auth-fastify-adapter"]);
  });
});
