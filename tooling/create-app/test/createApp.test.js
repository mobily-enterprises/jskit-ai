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

async function writeCrudCustomerResource(appRoot) {
  const resourcePath = path.join(appRoot, "packages", "customers", "src", "shared", "customerResource.js");
  await mkdir(path.dirname(resourcePath), { recursive: true });
  await writeFile(
    resourcePath,
    `const customerRecordSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    firstName: { type: "string" },
    email: { type: "string" },
    vip: { type: "boolean" }
  },
  additionalProperties: false
};

const customerBodySchema = {
  type: "object",
  properties: {
    firstName: { type: "string", maxLength: 120 },
    email: { type: "string", maxLength: 160 },
    vip: { type: "boolean" }
  },
  additionalProperties: false
};

const resource = {
  namespace: "customers",
  operations: {
    list: {
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: customerRecordSchema
            },
            nextCursor: { type: ["string", "null"] }
          },
          additionalProperties: false
        }
      }
    },
    view: {
      outputValidator: {
        schema: customerRecordSchema
      }
    },
    create: {
      bodyValidator: {
        schema: customerBodySchema
      },
      outputValidator: {
        schema: customerRecordSchema
      }
    },
    patch: {
      bodyValidator: {
        schema: customerBodySchema
      },
      outputValidator: {
        schema: customerRecordSchema
      }
    }
  }
};

export { resource };
`,
    "utf8"
  );
}

test("create-app scaffolds the base shell with placeholder replacements", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const result = runCli({ cwd, args: ["sample-app"] });

    assert.equal(result.status, 0, result.stderr);

    const appRoot = path.join(cwd, "sample-app");
    const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(packageJson.name, "sample-app");
    assert.equal(packageJson.scripts.preinstall, undefined);
    assert.equal(packageJson.scripts["verdaccio:reset:publish"], undefined);
    assert.equal(packageJson.scripts.postinstall, undefined);
    assert.equal(packageJson.scripts["dev:all"], "vite");
    assert.equal(packageJson.scripts["dev:home"], "VITE_SURFACE=home vite");
    assert.equal(packageJson.scripts["dev:console"], undefined);
    assert.equal(packageJson.scripts["dev:account"], undefined);
    assert.equal(packageJson.scripts["dev:auth"], undefined);
    assert.equal(packageJson.scripts["dev:app"], undefined);
    assert.equal(packageJson.scripts["dev:admin"], undefined);
    assert.equal(packageJson.scripts["server:all"], "node ./bin/server.js");
    assert.equal(packageJson.scripts["server:home"], "SERVER_SURFACE=home node ./bin/server.js");
    assert.equal(packageJson.scripts["server:console"], undefined);
    assert.equal(packageJson.scripts["server:account"], undefined);
    assert.equal(packageJson.scripts["server:auth"], undefined);
    assert.equal(packageJson.scripts["server:app"], undefined);
    assert.equal(packageJson.scripts["server:admin"], undefined);
    assert.equal(packageJson.scripts["build:all"], "vite build");
    assert.equal(packageJson.scripts["build:console"], undefined);
    assert.equal(packageJson.scripts["build:account"], undefined);
    assert.equal(packageJson.scripts["build:auth"], undefined);
    assert.equal(packageJson.scripts["build:app"], undefined);
    assert.equal(packageJson.scripts["build:admin"], undefined);
    assert.equal(packageJson.scripts.server, "node ./bin/server.js");
    assert.equal(packageJson.scripts.start, "node ./bin/server.js");
    assert.equal(packageJson.scripts.devlinks, "jskit app link-local-packages");
    assert.equal(packageJson.scripts.verify, "jskit app verify && npm run --if-present verify:app");
    assert.equal(packageJson.scripts.release, "jskit app release");
    assert.equal(packageJson.scripts["jskit:update"], "jskit app update-packages");
    assert.equal(packageJson.dependencies["@local/main"], "file:packages/main");
    assert.equal(packageJson.dependencies["@fastify/static"], "^9.1.1");
    assert.match(packageJson.dependencies["@jskit-ai/http-runtime"], /^\d+\.x$/);
    assert.equal(packageJson.dependencies["@fastify/type-provider-typebox"], "^6.1.0");
    assert.equal(packageJson.dependencies.pinia, "^3.0.4");
    await assert.rejects(access(path.join(appRoot, "scripts/copy-local-packages.sh")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "scripts/link-local-jskit-packages.sh")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "scripts/release.sh")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "scripts/update-jskit-packages.sh")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "scripts/dev-bootstrap-jskit.sh")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "scripts/just_run_verde")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "scripts/verdaccio-reset-and-publish-packages.sh")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "scripts/verdaccio/config.yaml")), /ENOENT/);

    await assert.rejects(access(path.join(appRoot, "README.md")), /ENOENT/);

    const appJson = JSON.parse(await readFile(path.join(appRoot, "app.json"), "utf8"));
    assert.equal(appJson.name, "sample-app");
    assert.equal(appJson.healthchecks.web[0].path, "/api/health");
    assert.equal(appJson.healthchecks.web[0].type, "startup");

    const gitignore = await readFile(path.join(appRoot, ".gitignore"), "utf8");
    assert.match(gitignore, /node_modules\//);
    assert.match(gitignore, /\.jskit\/verification\//);

    const indexHtml = await readFile(path.join(appRoot, "index.html"), "utf8");
    assert.match(indexHtml, /<title>Sample App<\/title>/);
    assert.match(indexHtml, /href="\/favicon\.svg"/);

    const favicon = await readFile(path.join(appRoot, "favicon.svg"), "utf8");
    assert.match(favicon, /<svg/);

    const serverSmoke = await readFile(path.join(appRoot, "tests/server/smoke.test.js"), "utf8");
    assert.match(serverSmoke, /GET \/api\/health returns built-in health response/);

    const clientSmoke = await readFile(path.join(appRoot, "tests/client/smoke.vitest.js"), "utf8");
    assert.match(clientSmoke, /sample-app client smoke/);

    const mainJs = await readFile(path.join(appRoot, "src/main.js"), "utf8");
    assert.match(mainJs, /import App from "\.\/App\.vue";/);
    assert.match(mainJs, /import \{ createPinia \} from "pinia";/);
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
    assert.match(mainJs, /const pinia = createPinia\(\);/);
    assert.match(mainJs, /appPlugins:\s*\[pinia,\s*vuetify\]/);
    assert.match(mainJs, /appPlugins:\s*\[pinia,\s*vuetify\],[\s\S]*?\bpinia,\s*router,/);
    assert.match(mainJs, /fallbackRoute/);

    await assert.rejects(access(path.join(appRoot, "config/surfaces.js")), /ENOENT/);
    const publicConfig = await readFile(path.join(appRoot, "config/public.js"), "utf8");
    assert.doesNotMatch(publicConfig, /config\.tenancyMode/);
    assert.match(publicConfig, /config\.surfaceModeAll = "all";/);
    assert.match(publicConfig, /config\.surfaceDefaultId = "home";/);
    assert.match(publicConfig, /config\.webRootAllowed = "no";/);
    assert.match(publicConfig, /config\.surfaceDefinitions = \{\};/);
    assert.match(publicConfig, /config\.surfaceDefinitions\.home = \{/);
    assert.match(publicConfig, /pagesRoot:\s*"home"/);
    assert.match(publicConfig, /requiresAuth:\s*false/);
    assert.match(publicConfig, /requiresWorkspace:\s*false/);
    assert.match(publicConfig, /origin:\s*""/);
    const surfaceAccessPoliciesConfig = await readFile(
      path.join(appRoot, "config/surfaceAccessPolicies.js"),
      "utf8"
    );
    assert.match(surfaceAccessPoliciesConfig, /surfaceAccessPolicies\.public = \{\};/);
    assert.doesNotMatch(surfaceAccessPoliciesConfig, /surfaceAccessPolicies\.authenticated/);
    const serverConfig = await readFile(path.join(appRoot, "config/server.js"), "utf8");
    assert.match(serverConfig, /export const config = \{\};/);

    const serverJs = await readFile(path.join(appRoot, "server.js"), "utf8");
    assert.match(serverJs, /function resolveGlobalUiPaths\(runtimeGlobalUiPaths = \[\]\)/);
    assert.match(serverJs, /globalUiPaths:\s*resolveGlobalUiPaths\(runtime\?\.globalUiPaths\s*\|\|\s*\[\]\)/);
    assert.match(serverJs, /registerTypeBoxFormats\(\);/);
    assert.match(serverJs, /app\.setValidatorCompiler\(TypeBoxValidatorCompiler\);/);
    assert.doesNotMatch(serverJs, /defaultProfile:\s*"app"/);

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
    assert.match(localMainServiceProvider, /import \{ loadAppConfig \} from "\.\.\/support\/loadAppConfig\.js";/);
    assert.match(localMainServiceProvider, /async register\(app\)/);
    assert.match(localMainServiceProvider, /await loadAppConfig\(\{\s*moduleUrl: import\.meta\.url\s*\}\);/);
    assert.match(localMainServiceProvider, /app\.instance\("appConfig", appConfig\);/);
    assert.match(localMainServiceProvider, /boot\(\)\s*\{\}/);
    assert.match(localMainServiceProvider, /src\/shared\/schemas/);

    const localMainAppConfigLoader = await readFile(
      path.join(appRoot, "packages/main/src/server/support/loadAppConfig.js"),
      "utf8"
    );
    assert.match(localMainAppConfigLoader, /@jskit-ai\/kernel\/server\/support/);
    assert.match(localMainAppConfigLoader, /loadAppConfigFromModuleUrl/);
    assert.match(localMainAppConfigLoader, /return loadAppConfigFromModuleUrl\(\{/);

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
    assert.match(localMainDescriptor, /entrypoint:\s*"src\/client\/providers\/MainClientProvider\.js"/);
    assert.match(localMainDescriptor, /export:\s*"MainClientProvider"/);

    const localMainClientEntrypoint = await readFile(path.join(appRoot, "packages/main/src/client/index.js"), "utf8");
    assert.match(localMainClientEntrypoint, /MainClientProvider/);
    assert.match(localMainClientEntrypoint, /registerMainClientComponent/);

    const localMainClientProvider = await readFile(
      path.join(appRoot, "packages/main/src/client/providers/MainClientProvider.js"),
      "utf8"
    );
    assert.match(localMainClientProvider, /class MainClientProvider/);
    assert.match(localMainClientProvider, /static id = "local\.main\.client";/);
    assert.match(localMainClientProvider, /function registerMainClientComponent/);
    assert.match(localMainClientProvider, /mainClientComponents\.push\(\{ token, resolveComponent \}\);/);
    assert.match(localMainClientProvider, /for \(const \{ token, resolveComponent \} of mainClientComponents\)/);
    assert.doesNotMatch(localMainClientProvider, /String\(componentToken \|\| ""\)\.trim\(\)/);
    assert.doesNotMatch(localMainClientProvider, /Object\.freeze\(\{\s*token,\s*resolveComponent\s*\}\)/);
    assert.doesNotMatch(localMainClientProvider, /requires application singleton/);

    const lockfile = JSON.parse(await readFile(path.join(appRoot, ".jskit/lock.json"), "utf8"));
    assert.ok(lockfile.installedPackages["@local/main"]);
    assert.equal(lockfile.installedPackages["@local/main"].source.type, "local-package");
    assert.equal(lockfile.installedPackages["@local/main"].source.packagePath, "packages/main");
    assert.equal(lockfile.installedPackages["@local/main"].source.descriptorPath, "packages/main/package.descriptor.mjs");

    const notFoundView = await readFile(path.join(appRoot, "src/views/NotFound.vue"), "utf8");
    assert.match(notFoundView, /The page you requested does not exist\./);

    await assert.rejects(access(path.join(appRoot, "src/pages/index.vue")), /ENOENT/);
    const homeView = await readFile(path.join(appRoot, "src/pages/home/index.vue"), "utf8");
    assert.doesNotMatch(homeView, /@jskit-ai\/shell-web/);
    assert.match(homeView, /welcome/);
    assert.doesNotMatch(homeView, /const appTitle =/);
    await assert.rejects(access(path.join(appRoot, "src/pages/console.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/console/index.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/app.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/admin.vue")), /ENOENT/);

    const viteConfig = await readFile(path.join(appRoot, "vite.config.mjs"), "utf8");
    assert.doesNotMatch(viteConfig, /function reparentNestedChildrenToIndexOwners\(rootRoute\)/);
    assert.doesNotMatch(viteConfig, /^\s*beforeWriteFiles:\s*reparentNestedChildrenToIndexOwners/m);
    assert.match(viteConfig, /nestedChildren deprecated/);

    assert.doesNotMatch(result.stdout, /Then add framework capabilities:/);
    assert.doesNotMatch(result.stdout, /npx jskit add package auth-provider-supabase-core/);
    assert.doesNotMatch(result.stdout, /npx jskit add bundle auth-base/);
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

test("base-shell app agent wrapper does not hardcode machine-specific jskit paths", async () => {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const wrapperPath = path.join(packageRoot, "templates/base-shell/AGENTS.md");
  const body = await readFile(wrapperPath, "utf8");
  assert.doesNotMatch(body, /Development\/current\/jskit-ai/);
  assert.match(body, /node_modules\/@jskit-ai\/agent-docs\/templates\/app\/AGENTS\.md/);
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
      "auth",
      "workspaces"
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
    assert.match(stdout, /Initial framework setup commands \(auth\):/);
    assert.match(stdout, /npx jskit add package auth-provider-supabase-core/);
    assert.match(stdout, /npx jskit add bundle auth-base/);

    const publicConfig = await readFile(path.join(cwd, "interactive-app/config/public.js"), "utf8");
    assert.match(publicConfig, /config\.tenancyMode = "workspaces";/);
  });
});

test("create-app accepts tenancy-mode flag and writes it to config/public.js", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const result = runCli({
      cwd,
      args: ["tenancy-app", "--tenancy-mode", "personal"]
    });

    assert.equal(result.status, 0, result.stderr);

    const publicConfig = await readFile(path.join(cwd, "tenancy-app/config/public.js"), "utf8");
    assert.match(publicConfig, /config\.tenancyMode = "personal";/);
    assert.match(publicConfig, /config\.surfaceDefinitions = \{\};/);
    assert.match(publicConfig, /config\.surfaceDefinitions\.home = \{/);
    assert.match(publicConfig, /pagesRoot:\s*"home"/);
  });
});

test("create-app rejects invalid tenancy-mode values", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const result = runCli({
      cwd,
      args: ["invalid-tenancy-app", "--tenancy-mode", "enterprise"]
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid --tenancy-mode value "enterprise"/);
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

    await assert.rejects(access(path.join(appRoot, "README.md")), /ENOENT/);

    const indexHtml = await readFile(path.join(appRoot, "index.html"), "utf8");
    assert.match(indexHtml, /<title>Acme Starter<\/title>/);

    await assert.rejects(access(path.join(appRoot, "src/pages/index.vue")), /ENOENT/);
    const homeView = await readFile(path.join(appRoot, "src/pages/home/index.vue"), "utf8");
    assert.doesNotMatch(homeView, /@jskit-ai\/shell-web/);
    assert.match(homeView, /welcome/);
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
    assert.equal(procfile, "release: npm run db:migrate\nweb: npm run start\n");
    await assert.rejects(access(path.join(appRoot, "framework")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/app.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/admin.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/console.vue")), /ENOENT/);

    const addShellWebResult = runJskit({
      cwd: appRoot,
      args: ["add", "package", "shell-web"]
    });
    assert.equal(addShellWebResult.status, 0, addShellWebResult.stderr);

    await assert.rejects(access(path.join(appRoot, "src/pages/app.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/admin.vue")), /ENOENT/);
    const homeWrapper = await readFile(path.join(appRoot, "src/pages/home.vue"), "utf8");
    const mainClientProvider = await readFile(
      path.join(appRoot, "packages/main/src/client/providers/MainClientProvider.js"),
      "utf8"
    );
    const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));

    assert.match(homeWrapper, /"surface":\s*"home"/);
    await assert.rejects(access(path.join(appRoot, "src/pages/console.vue")), /ENOENT/);
    assert.match(mainClientProvider, /import MenuLinkItem from "\/src\/components\/menus\/MenuLinkItem\.vue";/);
    assert.match(mainClientProvider, /import SurfaceAwareMenuLinkItem from "\/src\/components\/menus\/SurfaceAwareMenuLinkItem\.vue";/);
    assert.match(mainClientProvider, /import TabLinkItem from "\/src\/components\/menus\/TabLinkItem\.vue";/);
    assert.match(mainClientProvider, /registerMainClientComponent\("local\.main\.ui\.menu-link-item", \(\) => MenuLinkItem\);/);
    assert.match(mainClientProvider, /registerMainClientComponent\("local\.main\.ui\.surface-aware-menu-link-item", \(\) => SurfaceAwareMenuLinkItem\);/);
    assert.match(mainClientProvider, /registerMainClientComponent\("local\.main\.ui\.tab-link-item", \(\) => TabLinkItem\);/);
    assert.equal(packageJson.scripts["dev:all"], "vite");
    assert.equal(packageJson.scripts["dev:home"], "VITE_SURFACE=home vite");
    assert.equal(packageJson.scripts["dev:console"], undefined);
    assert.equal(packageJson.scripts["dev:app"], undefined);
    assert.equal(packageJson.scripts["dev:admin"], undefined);
    await access(path.join(appRoot, "src/components/menus/MenuLinkItem.vue"));
    await access(path.join(appRoot, "src/components/menus/SurfaceAwareMenuLinkItem.vue"));
    await access(path.join(appRoot, "src/components/menus/TabLinkItem.vue"));
  });
});

test("fresh app CRUD scaffolds encode explicit M3 action hierarchy and stable settings links", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const createResult = runCli({ cwd, args: ["crud-ui-hierarchy-app"] });
    assert.equal(createResult.status, 0, createResult.stderr);

    const appRoot = path.join(cwd, "crud-ui-hierarchy-app");

    const addShellWebResult = runJskit({
      cwd: appRoot,
      args: ["add", "package", "shell-web"]
    });
    assert.equal(addShellWebResult.status, 0, addShellWebResult.stderr);

    await writeCrudCustomerResource(appRoot);

    const generateCrudResult = runJskit({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/crud-ui-generator",
        "crud",
        "home/settings/customers",
        "--resource-file",
        "packages/customers/src/shared/customerResource.js",
        "--id-param",
        "customerId"
      ]
    });
    assert.equal(generateCrudResult.status, 0, generateCrudResult.stderr);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    const listPageSource = await readFile(path.join(appRoot, "src/pages/home/settings/customers/index.vue"), "utf8");
    const viewPageSource = await readFile(path.join(appRoot, "src/pages/home/settings/customers/[customerId]/index.vue"), "utf8");
    const newPageSource = await readFile(path.join(appRoot, "src/pages/home/settings/customers/new.vue"), "utf8");
    const editPageSource = await readFile(path.join(appRoot, "src/pages/home/settings/customers/[customerId]/edit.vue"), "utf8");
    const addEditFormSource = await readFile(
      path.join(appRoot, "src/pages/home/settings/customers/_components/CrudAddEditForm.vue"),
      "utf8"
    );

    assert.match(placementSource, /target: "home-settings:primary-menu"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.surface-aware-menu-link-item"/);
    assert.match(placementSource, /scopedSuffix: "\/settings\/customers"/);
    assert.doesNotMatch(placementSource, /to: "\.\/customers"/);
    assert.doesNotMatch(placementSource, /to: "\.\/general"/);

    assert.match(listPageSource, /<v-btn color="primary" variant="tonal" :loading="records\.isFetching"/);
    assert.match(listPageSource, /<v-btn v-if="UI_NEW_URL" color="primary" variant="flat"/);
    assert.match(listPageSource, /size="small"[\s\S]*color="primary"[\s\S]*variant="outlined"[\s\S]*>\s*Open/);
    assert.match(listPageSource, /size="small"[\s\S]*color="primary"[\s\S]*variant="tonal"[\s\S]*>\s*Edit/);
    assert.match(listPageSource, /<v-btn color="primary" variant="outlined" :loading="records\.isLoadingMore"/);

    assert.match(viewPageSource, /v-if="UI_LIST_URL"[\s\S]*color="primary"[\s\S]*variant="outlined"/);
    assert.match(viewPageSource, /v-if="UI_EDIT_URL"[\s\S]*color="primary"[\s\S]*variant="flat"/);

    assert.match(newPageSource, /<CrudAddEditForm/);
    assert.match(newPageSource, /:cancel-to="UI_CANCEL_URL"/);

    assert.match(editPageSource, /<CrudAddEditForm/);
    assert.match(editPageSource, /:cancel-to="cancelTo"/);

    assert.match(addEditFormSource, /<v-btn v-if="cancelTo" color="primary" variant="outlined"/);
    assert.match(addEditFormSource, /color="primary"[\s\S]*variant="flat"[\s\S]*:loading="addEdit\.isSaving"/);
  });
});

test("workspaces-web workspace tenancy mode installs workspace surfaces and wrappers", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const createResult = runCli({ cwd, args: ["users-workspace-app", "--tenancy-mode", "workspaces"] });
    assert.equal(createResult.status, 0, createResult.stderr);

    const appRoot = path.join(cwd, "users-workspace-app");

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
        "http://localhost:5173"
      ]
    });
    assert.equal(addProviderResult.status, 0, addProviderResult.stderr);

    const addDatabaseDriverResult = runJskit({
      cwd: appRoot,
      args: [
        "add",
        "package",
        "database-runtime-postgres",
        "--db-name",
        "app_db",
        "--db-user",
        "app_user",
        "--db-password",
        "app_password"
      ]
    });
    assert.equal(addDatabaseDriverResult.status, 0, addDatabaseDriverResult.stderr);

    const addWorkspacesWebResult = runJskit({
      cwd: appRoot,
      args: ["add", "package", "workspaces-web"]
    });
    assert.equal(addWorkspacesWebResult.status, 0, addWorkspacesWebResult.stderr);

    const homeWrapper = await readFile(path.join(appRoot, "src/pages/home.vue"), "utf8");
    const appWrapper = await readFile(path.join(appRoot, "src/pages/w/[workspaceSlug].vue"), "utf8");
    const adminWrapper = await readFile(path.join(appRoot, "src/pages/w/[workspaceSlug]/admin.vue"), "utf8");
    const accountRootPage = await readFile(path.join(appRoot, "src/pages/account/index.vue"), "utf8");
    await assert.rejects(access(path.join(appRoot, "src/pages/account/settings/index.vue")), /ENOENT/);
    const accountSettingsClientElement = await readFile(
      path.join(appRoot, "src/components/account/settings/AccountSettingsClientElement.vue"),
      "utf8"
    );
    const placement = await readFile(path.join(appRoot, "src/placement.js"), "utf8");
    const mainClientProvider = await readFile(
      path.join(appRoot, "packages/main/src/client/providers/MainClientProvider.js"),
      "utf8"
    );
    const accountSettingsInvitesSection = await readFile(
      path.join(appRoot, "packages/main/src/client/components/AccountSettingsInvitesSection.vue"),
      "utf8"
    );
    const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    const accountPendingInvitesCue = await readFile(
      path.join(appRoot, "packages/main/src/client/components/AccountPendingInvitesCue.vue"),
      "utf8"
    );

    assert.match(homeWrapper, /@\/components\/ShellLayout\.vue/);
    assert.match(homeWrapper, /"surface":\s*"home"/);
    assert.match(adminWrapper, /@\/components\/ShellLayout\.vue/);
    assert.match(adminWrapper, /"surface":\s*"admin"/);
    assert.match(appWrapper, /@\/components\/ShellLayout\.vue/);
    assert.match(appWrapper, /"surface":\s*"app"/);
    const publicConfig = await readFile(path.join(appRoot, "config/public.js"), "utf8");
    assert.match(publicConfig, /config\.surfaceDefinitions\.home = \{/);
    assert.match(publicConfig, /config\.surfaceDefinitions\.admin = \{/);
    assert.match(publicConfig, /config\.surfaceDefinitions\.app = \{/);
    assert.match(publicConfig, /pagesRoot:\s*"w\/\[workspaceSlug\]"/);
    assert.match(publicConfig, /pagesRoot:\s*"w\/\[workspaceSlug\]\/admin"/);
    assert.match(publicConfig, /config\.surfaceDefinitions\.account = \{/);
    assert.match(accountRootPage, /<AccountSettingsClientElement \/>/);
    assert.match(accountSettingsClientElement, /useRoute, useRouter/);
    assert.match(accountSettingsClientElement, /route\?\.query\?\.section/);
    assert.match(placement, /id:\s*"workspaces\.account\.invites\.cue"/);
    assert.match(placement, /componentToken:\s*"local\.main\.account\.pending-invites\.cue"/);
    assert.match(placement, /id:\s*"workspaces\.account\.settings\.invites"/);
    assert.match(placement, /target:\s*"account-settings:sections"/);
    assert.match(placement, /componentToken:\s*"local\.main\.account-settings\.section\.invites"/);
    assert.match(mainClientProvider, /import AccountPendingInvitesCue from "\.\.\/components\/AccountPendingInvitesCue\.vue";/);
    assert.match(
      mainClientProvider,
      /import AccountSettingsInvitesSection from "\.\.\/components\/AccountSettingsInvitesSection\.vue";/
    );
    assert.match(
      mainClientProvider,
      /registerMainClientComponent\("local\.main\.account\.pending-invites\.cue", \(\) => AccountPendingInvitesCue\);/
    );
    assert.match(
      mainClientProvider,
      /registerMainClientComponent\("local\.main\.account-settings\.section\.invites", \(\) => AccountSettingsInvitesSection\);/
    );
    assert.match(accountPendingInvitesCue, /section:\s*"invites"/);
    assert.match(
      accountSettingsInvitesSection,
      /@jskit-ai\/workspaces-web\/client\/components\/AccountSettingsInvitesSection/
    );
    assert.match(packageJson.dependencies["@jskit-ai/workspaces-core"], /^\d+\.x$/);
    assert.match(packageJson.dependencies["@jskit-ai/workspaces-web"], /^\d+\.x$/);
    assert.equal(packageJson.scripts["server:account"], "SERVER_SURFACE=account node ./bin/server.js");
    assert.equal(packageJson.scripts["server:app"], "SERVER_SURFACE=app node ./bin/server.js");
    assert.equal(packageJson.scripts["server:admin"], "SERVER_SURFACE=admin node ./bin/server.js");
    assert.equal(packageJson.scripts["dev:account"], "VITE_SURFACE=account vite");
    assert.equal(packageJson.scripts["dev:app"], "VITE_SURFACE=app vite");
    assert.equal(packageJson.scripts["dev:admin"], "VITE_SURFACE=admin vite");
    await assert.rejects(access(path.join(appRoot, "src/pages/console.vue")), /ENOENT/);
  });
});

test("generated app supports shell + auth progressive installation", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const createResult = runCli({ cwd, args: ["shell-auth-app"] });
    assert.equal(createResult.status, 0, createResult.stderr);

    const appRoot = path.join(cwd, "shell-auth-app");
    const publicConfigPath = path.join(appRoot, "config/public.js");
    const publicConfig = await readFile(publicConfigPath, "utf8");
    await writeFile(publicConfigPath, `${publicConfig}\nconfig.tenancyMode = "workspaces";\n`, "utf8");

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
        "http://localhost:5173"
      ]
    });
    assert.equal(addProviderResult.status, 0, addProviderResult.stderr);

    const addAuthResult = runJskit({
      cwd: appRoot,
      args: ["add", "bundle", "auth-base"]
    });
    assert.equal(addAuthResult.status, 0, addAuthResult.stderr);

    const doctorResult = runJskit({ cwd: appRoot, args: ["doctor"] });
    assert.equal(doctorResult.status, 0, doctorResult.stderr);

    const lockfile = JSON.parse(await readFile(path.join(appRoot, ".jskit/lock.json"), "utf8"));
    assert.ok(lockfile.installedPackages["@jskit-ai/auth-provider-supabase-core"]);
    assert.ok(lockfile.installedPackages["@jskit-ai/auth-web"]);
    const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(packageJson.scripts["server:auth"], "SERVER_SURFACE=auth node ./bin/server.js");
    assert.equal(packageJson.scripts["dev:auth"], "VITE_SURFACE=auth vite");
    assert.equal(packageJson.scripts["build:auth"], "VITE_SURFACE=auth vite build");
    assert.match(packageJson.dependencies["@jskit-ai/auth-provider-supabase-core"], /^\d+\.x$/);
    assert.match(packageJson.dependencies["@jskit-ai/auth-core"], /^\d+\.x$/);
    assert.match(packageJson.dependencies["@jskit-ai/auth-web"], /^\d+\.x$/);

    const homeWrapper = await readFile(path.join(appRoot, "src/pages/home.vue"), "utf8");
    assert.match(homeWrapper, /@\/components\/ShellLayout\.vue/);
    await assert.rejects(access(path.join(appRoot, "src/pages/app.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/admin.vue")), /ENOENT/);
  });
});
