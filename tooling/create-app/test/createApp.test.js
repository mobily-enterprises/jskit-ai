import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli as runCreateAppCli } from "../src/server/index.js";
import { createCliRunner } from "../../testUtils/runCli.js";
import { runJskit } from "../../testUtils/runJskit.mjs";
import { withTempDir } from "../../testUtils/tempDir.mjs";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit-create-app.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);
const withCreateAppTempDir = (run) => withTempDir(run, { prefix: "jskit-create-app-" });

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

test("create-app scaffolds the base shell with placeholder replacements", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const result = runCli({ cwd, args: ["sample-app"] });

    assert.equal(result.status, 0, result.stderr);

    const appRoot = path.join(cwd, "sample-app");
    const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(packageJson.name, "sample-app");
    assert.equal(packageJson.scripts.preinstall, "bash ./scripts/dev-bootstrap-jskit.sh");
    assert.equal(packageJson.scripts.postinstall, undefined);
    await assert.rejects(access(path.join(appRoot, "scripts/copy-local-packages.sh")), /ENOENT/);
    const devBootstrapScript = await readFile(path.join(appRoot, "scripts/dev-bootstrap-jskit.sh"), "utf8");
    assert.match(devBootstrapScript, /JSKIT_DEV_BOOTSTRAP/);
    assert.match(devBootstrapScript, /JSKIT_GITHUB_TARBALL_URL/);
    assert.match(devBootstrapScript, /curl -fsSL/);

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
    assert.match(serverSmoke, /GET \/api\/v1\/health returns not found/);

    const clientSmoke = await readFile(path.join(appRoot, "tests/client/smoke.vitest.js"), "utf8");
    assert.match(clientSmoke, /sample-app client smoke/);

    const mainJs = await readFile(path.join(appRoot, "src/main.js"), "utf8");
    assert.match(mainJs, /import App from "\.\/App\.vue";/);
    assert.match(mainJs, /import NotFoundView from "\.\/views\/NotFound\.vue";/);
    assert.match(mainJs, /import \{ bootInstalledClientModules \} from "virtual:jskit-client-bootstrap";/);
    assert.doesNotMatch(mainJs, /@\/modules\/client-modules\.js/);
    assert.doesNotMatch(mainJs, /virtual:jskit-client-modules/);
    assert.doesNotMatch(mainJs, /collectClientModuleRoutes/);
    assert.match(mainJs, /@jskit-ai\/kernel\/shared\/surface\/runtime/);
    assert.match(mainJs, /@jskit-ai\/kernel\/client/);
    assert.match(mainJs, /buildSurfaceAwareRoutes/);
    assert.match(mainJs, /createShellBeforeEachGuard/);
    assert.match(mainJs, /createRouter, createWebHistory/);
    assert.match(mainJs, /router\.beforeEach\(/);
    assert.match(mainJs, /await bootInstalledClientModules\(/);
    assert.match(mainJs, /app\.mount\("#app"\)/);

    const surfacesConfig = await readFile(path.join(appRoot, "config/surfaces.js"), "utf8");
    assert.match(surfacesConfig, /requiresAuth:\s*false/);

    const serverJs = await readFile(path.join(appRoot, "server.js"), "utf8");
    assert.match(serverJs, /globalUiPaths:\s*runtime\?\.globalUiPaths\s*\|\|\s*\[\]/);

    const appVue = await readFile(path.join(appRoot, "src/App.vue"), "utf8");
    assert.match(appVue, /<RouterView \/>/);

    const notFoundView = await readFile(path.join(appRoot, "src/views/NotFound.vue"), "utf8");
    assert.match(notFoundView, /The page you requested does not exist\./);

    const indexView = await readFile(path.join(appRoot, "src/pages/index.vue"), "utf8");
    assert.match(indexView, /const title = "It worked!";/);
    assert.match(indexView, /const appTitle = "Sample App";/);

    assert.match(result.stdout, /npx jskit add auth-base --no-install/);
  });
});

test("create-app interactive flow captures initial bundle selection in guidance", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const stdoutCapture = createCaptureWritable();
    const stderrCapture = createCaptureWritable();
    const answers = [
      "interactive-app",
      "",
      "",
      "",
      "",
      "auth"
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
    assert.ok(askedPrompts.length >= 6);
    assert.match(stdout, /Initial framework bundle commands \(auth\):/);
    assert.match(stdout, /npx jskit add auth-base --no-install/);
  });
});

test("create-app refuses non-empty target directory without --force", async () => {
  await withCreateAppTempDir(async (cwd) => {
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
  await withCreateAppTempDir(async (cwd) => {
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
  await withCreateAppTempDir(async (cwd) => {
    const result = runCli({ cwd, args: ["dry-run-app", "--dry-run"] });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[dry-run\]/);

    await assert.rejects(access(path.join(cwd, "dry-run-app")), /ENOENT/);
  });
});

test("create-app allows non-empty target when --force is passed", async () => {
  await withCreateAppTempDir(async (cwd) => {
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
  await withCreateAppTempDir(async (cwd) => {
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

    const indexView = await readFile(path.join(appRoot, "src/pages/index.vue"), "utf8");
    assert.match(indexView, /const appTitle = "Acme Starter";/);
  });
});

test("generated shell-only app passes jskit doctor and keeps minimal Procfile", async () => {
  await withCreateAppTempDir(async (cwd) => {
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

test("generated app supports shell + auth progressive installation", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const createResult = runCli({ cwd, args: ["shell-auth-app"] });
    assert.equal(createResult.status, 0, createResult.stderr);

    const appRoot = path.join(cwd, "shell-auth-app");
    const addProviderResult = runJskit({
      cwd: appRoot,
      args: [
        "add",
        "package",
        "auth-provider-supabase-core",
        "--auth-supabase-url",
        "https://example.supabase.co",
        "--auth-supabase-publishable-key",
        "sb_publishable_example",
        "--app-public-url",
        "http://localhost:5173",
        "--no-install"
      ]
    });
    assert.equal(addProviderResult.status, 0, addProviderResult.stderr);

    const addAuthResult = runJskit({
      cwd: appRoot,
      args: ["add", "bundle", "auth-base", "--no-install"]
    });
    assert.equal(addAuthResult.status, 0, addAuthResult.stderr);

    const doctorResult = runJskit({ cwd: appRoot, args: ["doctor"] });
    assert.equal(doctorResult.status, 0, doctorResult.stderr);

    const lockfile = JSON.parse(await readFile(path.join(appRoot, ".jskit/lock.json"), "utf8"));
    assert.ok(lockfile.installedPackages["@jskit-ai/auth-provider-supabase-core"]);
    assert.ok(lockfile.installedPackages["@jskit-ai/auth-web"]);
  });
});
