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
    assert.equal(packageJson.dependencies["@local/main"], "file:packages/main");
    assert.equal(packageJson.dependencies["@jskit-ai/http-runtime"], "0.1.0");
    assert.equal(packageJson.dependencies["@fastify/type-provider-typebox"], "^6.1.0");
    await assert.rejects(access(path.join(appRoot, "scripts/copy-local-packages.sh")), /ENOENT/);
    const devBootstrapScript = await readFile(path.join(appRoot, "scripts/dev-bootstrap-jskit.sh"), "utf8");
    assert.match(devBootstrapScript, /JSKIT_DEV_BOOTSTRAP/);
    assert.match(devBootstrapScript, /DOKKU_APP_NAME/);
    assert.match(devBootstrapScript, /JSKIT_GITHUB_TARBALL_URL/);
    assert.match(devBootstrapScript, /curl -fsSL/);
    assert.doesNotMatch(devBootstrapScript, /Development\/current\/jskit-ai/);
    const linkLocalScript = await readFile(path.join(appRoot, "scripts/link-local-jskit-packages.sh"), "utf8");
    assert.doesNotMatch(linkLocalScript, /Development\/current\/jskit-ai/);
    const verdaccioScript = await readFile(
      path.join(appRoot, "scripts/verdaccio-reset-and-publish-packages.sh"),
      "utf8"
    );
    assert.doesNotMatch(verdaccioScript, /Development\/current\/jskit-ai/);

    const readme = await readFile(path.join(appRoot, "README.md"), "utf8");
    assert.match(readme, /^# Sample App$/m);
    assert.match(readme, /npm run dev/);
    assert.match(readme, /npx jskit add auth-base --no-install/);
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
    assert.match(mainJs, /createShellRouter/);
    assert.match(mainJs, /bootstrapClientShellApp/);
    assert.match(mainJs, /createRouter, createWebHistory/);
    assert.match(mainJs, /bootClientModules:\s*bootInstalledClientModules/);
    assert.match(mainJs, /appPlugins:\s*\[vuetify\]/);
    assert.match(mainJs, /fallbackRoute/);

    await assert.rejects(access(path.join(appRoot, "config/surfaces.js")), /ENOENT/);
    const publicConfig = await readFile(path.join(appRoot, "config/public.js"), "utf8");
    assert.match(publicConfig, /config\.surfaceModeAll = "all";/);
    assert.match(publicConfig, /config\.surfaceDefinitions = \{/);
    assert.match(publicConfig, /requiresAuth:\s*false/);
    const serverConfig = await readFile(path.join(appRoot, "config/server.js"), "utf8");
    assert.match(serverConfig, /export const config = \{\};/);

    const serverJs = await readFile(path.join(appRoot, "server.js"), "utf8");
    assert.match(serverJs, /globalUiPaths:\s*runtime\?\.globalUiPaths\s*\|\|\s*\[\]/);
    assert.match(serverJs, /registerTypeBoxFormats\(\);/);
    assert.match(serverJs, /app\.setValidatorCompiler\(TypeBoxValidatorCompiler\);/);

    const appVue = await readFile(path.join(appRoot, "src/App.vue"), "utf8");
    assert.match(appVue, /<RouterView \/>/);

    const localMainPackageJson = JSON.parse(
      await readFile(path.join(appRoot, "packages/main/package.json"), "utf8")
    );
    assert.equal(localMainPackageJson.name, "@local/main");
    assert.equal(
      localMainPackageJson.exports["./server/providers/MainServiceProvider"],
      "./src/server/providers/MainServiceProvider.js"
    );

    await assert.rejects(access(path.join(appRoot, "packages/main/src/index.js")), /ENOENT/);

    const localMainServerEntrypoint = await readFile(path.join(appRoot, "packages/main/src/server/index.js"), "utf8");
    assert.match(localMainServerEntrypoint, /export \{ MainServiceProvider \}/);

    const localMainServiceProvider = await readFile(
      path.join(appRoot, "packages/main/src/server/providers/MainServiceProvider.js"),
      "utf8"
    );
    assert.match(localMainServiceProvider, /class MainServiceProvider/);
    assert.match(localMainServiceProvider, /static id = "local\.main";/);
    assert.match(localMainServiceProvider, /import \{ config as publicConfig \} from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/config\/public\.js";/);
    assert.match(localMainServiceProvider, /import \{ config as serverConfig \} from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/config\/server\.js";/);
    assert.match(localMainServiceProvider, /app\.instance\("appConfig", appConfig\);/);
    assert.match(localMainServiceProvider, /boot\(\)\s*\{\}/);
    assert.match(localMainServiceProvider, /src\/shared\/schemas/);

    const localMainControllersIndex = await readFile(
      path.join(appRoot, "packages/main/src/server/controllers/index.js"),
      "utf8"
    );
    assert.match(localMainControllersIndex, /export \{\};/);

    const localMainServicesIndex = await readFile(
      path.join(appRoot, "packages/main/src/server/services/index.js"),
      "utf8"
    );
    assert.match(localMainServicesIndex, /export \{\};/);

    const localMainRoutesIndex = await readFile(
      path.join(appRoot, "packages/main/src/server/routes/index.js"),
      "utf8"
    );
    assert.match(localMainRoutesIndex, /export \{\};/);

    const localMainDescriptor = await readFile(path.join(appRoot, "packages/main/package.descriptor.mjs"), "utf8");
    assert.match(localMainDescriptor, /packageId:\s*"@local\/main"/);
    assert.match(localMainDescriptor, /providerEntrypoint:\s*"src\/server\/index\.js"/);
    assert.match(localMainDescriptor, /discover:\s*\{/);
    assert.match(localMainDescriptor, /dir:\s*"src\/server\/providers"/);
    assert.match(localMainDescriptor, /pattern:\s*"\*Provider\.js"/);

    const lockfile = JSON.parse(await readFile(path.join(appRoot, ".jskit/lock.json"), "utf8"));
    assert.ok(lockfile.installedPackages["@local/main"]);
    assert.equal(lockfile.installedPackages["@local/main"].source.type, "local-package");
    assert.equal(lockfile.installedPackages["@local/main"].source.packagePath, "packages/main");
    assert.equal(lockfile.installedPackages["@local/main"].source.descriptorPath, "packages/main/package.descriptor.mjs");

    const notFoundView = await readFile(path.join(appRoot, "src/views/NotFound.vue"), "utf8");
    assert.match(notFoundView, /The page you requested does not exist\./);

    const indexView = await readFile(path.join(appRoot, "src/pages/index.vue"), "utf8");
    assert.doesNotMatch(indexView, /@jskit-ai\/shell-web/);
    assert.match(indexView, /welcome/);
    assert.doesNotMatch(indexView, /const appTitle =/);

    assert.match(result.stdout, /npx jskit add auth-base --no-install/);
  });
});

test("create-app scaffolds stagex with main service provider and contact routes", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const result = runCli({ cwd, args: ["stagex-app", "--template", "stagex"] });

    assert.equal(result.status, 0, result.stderr);

    const appRoot = path.join(cwd, "stagex-app");

    const readme = await readFile(path.join(appRoot, "README.md"), "utf8");
    assert.match(readme, /template: `stagex`/);
    assert.match(readme, /POST \/api\/v1\/contacts\/intake/);
    assert.match(readme, /POST \/api\/v1\/contacts\/preview-followup/);
    assert.match(readme, /GET \/api\/v1\/contacts\/:contactId/);

    const localMainServerEntrypoint = await readFile(path.join(appRoot, "packages/main/src/server/index.js"), "utf8");
    assert.match(localMainServerEntrypoint, /export \{ MainServiceProvider \}/);

    const localMainProvider = await readFile(
      path.join(appRoot, "packages/main/src/server/providers/MainServiceProvider.js"),
      "utf8"
    );
    assert.match(localMainProvider, /class MainServiceProvider/);
    assert.match(localMainProvider, /static id = "local\.main";/);
    assert.match(localMainProvider, /import \{ config as publicConfig \} from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/config\/public\.js";/);
    assert.match(localMainProvider, /import \{ config as serverConfig \} from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/config\/server\.js";/);
    assert.match(localMainProvider, /app\.instance\("appConfig", appConfig\);/);
    assert.match(localMainProvider, /\/api\/v1\/contacts\/intake/);
    assert.match(localMainProvider, /\/api\/v1\/contacts\/preview-followup/);
    assert.match(localMainProvider, /\/api\/v1\/contacts\/:contactId/);
    assert.doesNotMatch(localMainProvider, /stage-7|Stage7|stage7/);

    const localMainDescriptor = await readFile(path.join(appRoot, "packages/main/package.descriptor.mjs"), "utf8");
    assert.match(localMainDescriptor, /discover:\s*\{/);
    assert.match(localMainDescriptor, /dir:\s*"src\/server\/providers"/);
    assert.match(localMainDescriptor, /path:\s*"\/api\/v1\/contacts\/intake"/);
    assert.match(localMainDescriptor, /path:\s*"\/api\/v1\/contacts\/preview-followup"/);
    assert.match(localMainDescriptor, /path:\s*"\/api\/v1\/contacts\/:contactId"/);

    const contactRouteValidators = await readFile(
      path.join(appRoot, "packages/main/src/shared/schemas/contactRouteValidators.js"),
      "utf8"
    );
    assert.match(contactRouteValidators, /contact_domain_invalid/);
    assert.doesNotMatch(contactRouteValidators, /stage-7|Stage7|stage7/);
  });
});

test("create-app rejects template path traversal names", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const traversalResult = runCli({ cwd, args: ["safe-app", "--template", "../base-shell"] });
    assert.notEqual(traversalResult.status, 0);
    assert.match(traversalResult.stderr, /Invalid template/);

    const absoluteResult = runCli({ cwd, args: ["safe-app", "--template", "/tmp/base-shell"] });
    assert.notEqual(absoluteResult.status, 0);
    assert.match(absoluteResult.stderr, /Invalid template|Unknown template/);
  });
});

test("base-shell scripts do not hardcode machine-specific jskit paths", async () => {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const baseScriptsDir = path.join(packageRoot, "templates/base-shell/scripts");
  const scriptPaths = [
    path.join(baseScriptsDir, "dev-bootstrap-jskit.sh"),
    path.join(baseScriptsDir, "link-local-jskit-packages.sh"),
    path.join(baseScriptsDir, "verdaccio-reset-and-publish-packages.sh")
  ];

  for (const scriptPath of scriptPaths) {
    const body = await readFile(scriptPath, "utf8");
    assert.doesNotMatch(body, /Development\/current\/jskit-ai/);
  }
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
    assert.doesNotMatch(indexView, /@jskit-ai\/shell-web/);
    assert.match(indexView, /welcome/);
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

    const addShellWebResult = runJskit({
      cwd: appRoot,
      args: ["add", "package", "shell-web", "--no-install"]
    });
    assert.equal(addShellWebResult.status, 0, addShellWebResult.stderr);

    const appWrapper = await readFile(path.join(appRoot, "src/pages/app.vue"), "utf8");
    const adminWrapper = await readFile(path.join(appRoot, "src/pages/admin.vue"), "utf8");
    const consoleWrapper = await readFile(path.join(appRoot, "src/pages/console.vue"), "utf8");

    assert.match(appWrapper, /@jskit-ai\/shell-web\/client\/components\/ShellLayout/);
    assert.match(adminWrapper, /@jskit-ai\/shell-web\/client\/components\/ShellLayout/);
    assert.match(consoleWrapper, /@jskit-ai\/shell-web\/client\/components\/ShellLayout/);
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
