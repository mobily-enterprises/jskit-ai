import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli as runCreateAppCli } from "../src/server/index.js";
import { createCliRunner } from "../../testUtils/runCli.js";
import { runJskit } from "../../testUtils/runJskit.mjs";
import { withTempDir } from "../../testUtils/tempDir.mjs";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit-create-app.js", import.meta.url));
const JSON_REST_SCHEMA_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../../node_modules/json-rest-schema/package.json", import.meta.url))
);
const KERNEL_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../../packages/kernel/package.json", import.meta.url))
);
const RESOURCE_CORE_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../../packages/resource-core/package.json", import.meta.url))
);
const RESOURCE_CRUD_CORE_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../../packages/resource-crud-core/package.json", import.meta.url))
);
const SHELL_WEB_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../../packages/shell-web/package.json", import.meta.url))
);
const runCli = createCliRunner(CLI_PATH);
const withCreateAppTempDir = (run) => withTempDir(run, { prefix: "jskit-create-app-" });
const registryTest = process.env.JSKIT_REGISTRY_INTEGRATION === "1" ? test : test.skip;

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

async function linkTestPackage(nodeModulesDir, packageName, packageDir) {
  const targetPath = path.join(nodeModulesDir, packageName);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await symlink(packageDir, targetPath, "dir");
}

async function writeCrudCustomerResource(appRoot) {
  const resourcePath = path.join(appRoot, "packages", "customers", "src", "shared", "customerResource.js");
  const nodeModulesDir = path.join(appRoot, "node_modules");
  const appPackageJsonPath = path.join(appRoot, "package.json");
  const appPackageJson = JSON.parse(await readFile(appPackageJsonPath, "utf8"));
  appPackageJson.dependencies["@jskit-ai/resource-crud-core"] = `file:${RESOURCE_CRUD_CORE_PACKAGE_DIR}`;
  await writeFile(appPackageJsonPath, `${JSON.stringify(appPackageJson, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(resourcePath), { recursive: true });
  await mkdir(nodeModulesDir, { recursive: true });
  await linkTestPackage(nodeModulesDir, "json-rest-schema", JSON_REST_SCHEMA_PACKAGE_DIR);
  await linkTestPackage(nodeModulesDir, "@jskit-ai/kernel", KERNEL_PACKAGE_DIR);
  await linkTestPackage(nodeModulesDir, "@jskit-ai/resource-core", RESOURCE_CORE_PACKAGE_DIR);
  await linkTestPackage(nodeModulesDir, "@jskit-ai/resource-crud-core", RESOURCE_CRUD_CORE_PACKAGE_DIR);
  await linkTestPackage(nodeModulesDir, "@jskit-ai/shell-web", SHELL_WEB_PACKAGE_DIR);
  await writeFile(
    resourcePath,
    `import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const resource = defineCrudResource({
  namespace: "customers",
  tableName: "customers",
  schema: {
    firstName: {
      type: "string",
      required: true,
      maxLength: 120,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    email: {
      type: "string",
      required: true,
      maxLength: 160,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    vip: {
      type: "boolean",
      required: true,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    updatedAt: {
      type: "dateTime",
      required: true,
      operations: {
        output: { required: true }
      }
    }
  },
  crudOperations: ["list", "view", "create", "patch"]
});

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
    assert.equal(packageJson.engines.node, "26.x");
    assert.deepEqual(packageJson.allowScripts, {
      "fsevents@2.3.2": true,
      "fsevents@2.3.3": true,
      "vue-demi@0.14.10": true
    });
    assert.equal(await readFile(path.join(appRoot, ".nvmrc"), "utf8"), "26\n");
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
    assert.equal(packageJson.scripts["test:e2e"], "playwright test tests/e2e");
    assert.equal(packageJson.scripts.verify, "jskit app verify && npm run --if-present verify:app");
    assert.equal(packageJson.scripts.release, "jskit app release");
    assert.equal(packageJson.scripts["jskit:update"], "jskit app update-packages");
    assert.equal(packageJson.dependencies["@local/main"], "file:packages/main");
    assert.equal(packageJson.dependencies["@fastify/static"], "^9.1.3");
    assert.match(packageJson.dependencies["@jskit-ai/http-runtime"], /^\d+\.\d+\.\d+$/);
    assert.equal(packageJson.dependencies["@mdi/js"], "^7.4.47");
    assert.match(packageJson.dependencies["@jskit-ai/shell-web"], /^\d+\.\d+\.\d+$/);
    assert.equal(
      Object.keys(packageJson.dependencies).some((entry) => entry.includes("type-provider") && entry.includes("fastify")),
      false
    );
    assert.equal(packageJson.dependencies.pinia, "^3.0.4");
    assert.equal(packageJson.dependencies["json-rest-schema"], "^1.0.17");
    assert.equal(packageJson.dependencies.vue, "^3.5.38");
    assert.equal(packageJson.dependencies["vue-router"], "^5.1.0");
    assert.equal(packageJson.dependencies.vuetify, "^4.1.2");
    assert.equal(packageJson.dependencies["json-rest-schema"], "^1.0.17");
    assert.equal(packageJson.dependencies["@tanstack/vue-query"], "^5.101.0");
    assert.equal(packageJson.devDependencies["@playwright/test"], "1.61.1");
    assert.equal(packageJson.devDependencies["@vitejs/plugin-vue"], "^6.0.7");
    assert.equal(packageJson.devDependencies.eslint, "^10.8.0");
    assert.equal(packageJson.devDependencies.vite, "^8.2.1");
    assert.equal(packageJson.devDependencies.vitest, "^4.1.9");
    await assert.rejects(access(path.join(appRoot, "scripts/release.sh")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "scripts/update-jskit-packages.sh")), /ENOENT/);
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
    assert.match(gitignore, /src\/typed-router\.d\.ts/);
    await assert.rejects(access(path.join(appRoot, "src/typed-router.d.ts")), /ENOENT/);

    await assert.rejects(
      access(path.join(appRoot, ".github", "workflows", "jskit-verify.yml")),
      /ENOENT/
    );
    assert.match(result.stdout, /npx jskit ci generate/u);

    const indexHtml = await readFile(path.join(appRoot, "index.html"), "utf8");
    assert.match(indexHtml, /<title>Sample App<\/title>/);
    assert.match(indexHtml, /href="\/favicon\.svg"/);

    const favicon = await readFile(path.join(appRoot, "favicon.svg"), "utf8");
    assert.match(favicon, /<svg/);

    const serverSmoke = await readFile(path.join(appRoot, "tests/server/smoke.test.js"), "utf8");
    assert.match(serverSmoke, /GET \/api\/health returns built-in health response/);

    const clientSmoke = await readFile(path.join(appRoot, "tests/client/smoke.vitest.js"), "utf8");
    assert.match(clientSmoke, /sample-app client smoke/);
    const e2eSmoke = await readFile(path.join(appRoot, "tests/e2e/base-shell.spec.ts"), "utf8");
    assert.match(e2eSmoke, /@jskit-ai\/jskit-cli\/test\/playwright/u);
    assert.match(e2eSmoke, /DEFAULT_VIEWPORTS, runGeneratedAppSmokeCase/u);
    assert.match(e2eSmoke, /test\(`\$\{viewport\.name\} home route renders without horizontal overflow`/u);
    assert.match(e2eSmoke, /runGeneratedAppSmokeCase\(\{ page, expect, expectedText: "Ready", viewport \}\)/u);
    assert.doesNotMatch(e2eSmoke, /runGeneratedAppSmoke\(\{/u);
    assert.doesNotMatch(e2eSmoke, /PLAYWRIGHT_BASE_URL|scrollWidth|390|768|1280/u);

    const adaptiveShellSmoke = await readFile(path.join(appRoot, "tests/e2e/adaptive-shell.spec.ts"), "utf8");
    assert.match(adaptiveShellSmoke, /@jskit-ai\/shell-web\/test\/adaptiveShellSmoke/u);
    assert.match(adaptiveShellSmoke, /DEFAULT_VIEWPORTS, runAdaptiveShellSmokeCase/u);
    assert.match(adaptiveShellSmoke, /test\(`\$\{viewport\.name\} layout has reachable navigation and no horizontal overflow`/u);
    assert.match(adaptiveShellSmoke, /runAdaptiveShellSmokeCase\(\{ page, expect, viewport \}\)/u);
    assert.doesNotMatch(adaptiveShellSmoke, /runAdaptiveShellSmoke\(\{/u);

    const playwrightConfig = await readFile(path.join(appRoot, "playwright.config.mjs"), "utf8");
    assert.match(playwrightConfig, /@jskit-ai\/jskit-cli\/test\/playwright/u);
    assert.match(playwrightConfig, /defineConfig\(createJskitPlaywrightConfig\(\)\)/u);
    assert.doesNotMatch(playwrightConfig, /PLAYWRIGHT_BASE_URL|webServer|4173/u);

    const mainJs = await readFile(path.join(appRoot, "src/main.js"), "utf8");
    assert.match(mainJs, /import App from "\.\/App\.vue";/);
    assert.match(mainJs, /import \{ createPinia \} from "pinia";/);
    assert.match(mainJs, /import \{ QueryClient, VueQueryPlugin \} from "@tanstack\/vue-query";/);
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
    assert.match(mainJs, /const queryClient = new QueryClient\(/);
    assert.match(mainJs, /\[VueQueryPlugin,\s*\{ queryClient \}\]/);
    assert.match(mainJs, /appPlugins:[\s\S]*?pinia,[\s\S]*?\[VueQueryPlugin,\s*\{ queryClient \}\],[\s\S]*?vuetify/);
    assert.match(mainJs, /\bpinia,[\s\S]*?\bqueryClient,[\s\S]*?\brouter,/);
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
    assert.match(serverJs, /allowUnionTypes:\s*true/);
    assert.doesNotMatch(serverJs, /register[A-Za-z]+Formats\(\);/);
    assert.doesNotMatch(serverJs, /ValidatorCompiler/);
    assert.doesNotMatch(serverJs, /defaultProfile:\s*"app"/);

    const appVue = await readFile(path.join(appRoot, "src/App.vue"), "utf8");
    assert.match(appVue, /ShellErrorHost/);
    assert.match(appVue, /<RouterView \/>/);

    const localMainPackageJson = JSON.parse(
      await readFile(path.join(appRoot, "packages/main/package.json"), "utf8")
    );
    assert.equal(localMainPackageJson.name, "@local/main");
    assert.equal(
      localMainPackageJson.exports["./server/MainServiceProvider"],
      "./src/server/MainServiceProvider.js"
    );

    await assert.rejects(access(path.join(appRoot, "packages/main/src/index.js")), /ENOENT/);

    const localMainServerEntrypoint = await readFile(path.join(appRoot, "packages/main/src/server/index.js"), "utf8");
    assert.match(localMainServerEntrypoint, /export \{ MainServiceProvider \}/);
    assert.match(localMainServerEntrypoint, /\.\/MainServiceProvider\.js/);

    const localMainServiceProvider = await readFile(
      path.join(appRoot, "packages/main/src/server/MainServiceProvider.js"),
      "utf8"
    );
    assert.match(localMainServiceProvider, /class MainServiceProvider/);
    assert.match(localMainServiceProvider, /static id = "local\.main";/);
    assert.match(localMainServiceProvider, /import \{ loadAppConfig \} from "\.\/loadAppConfig\.js";/);
    assert.match(localMainServiceProvider, /async register\(app\)/);
    assert.match(localMainServiceProvider, /await loadAppConfig\(\{\s*moduleUrl: import\.meta\.url\s*\}\);/);
    assert.match(localMainServiceProvider, /app\.instance\("appConfig", appConfig\);/);
    assert.match(localMainServiceProvider, /boot\(\)\s*\{\}/);
    assert.match(localMainServiceProvider, /packages\/main as app glue only/);
    assert.match(localMainServiceProvider, /feature-server-generator scaffold <feature-name>/);

    const localMainAppConfigLoader = await readFile(
      path.join(appRoot, "packages/main/src/server/loadAppConfig.js"),
      "utf8"
    );
    assert.match(localMainAppConfigLoader, /@jskit-ai\/kernel\/server\/support/);
    assert.match(localMainAppConfigLoader, /loadAppConfigFromModuleUrl/);
    assert.match(localMainAppConfigLoader, /return loadAppConfigFromModuleUrl\(\{/);

    await assert.rejects(access(path.join(appRoot, "packages/main/src/server/controllers/index.js")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "packages/main/src/server/services/index.js")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "packages/main/src/server/routes/index.js")), /ENOENT/);

    const localMainPackage = JSON.parse(await readFile(path.join(appRoot, "packages/main/package.json"), "utf8"));
    assert.equal(localMainPackage.name, "@local/main");
    assert.equal(localMainPackage.description, "App-local main composition and glue scaffold.");
    assert.equal(localMainPackage.jskit.runtime.server.providerEntrypoint, "src/server/MainServiceProvider.js");
    assert.deepEqual(localMainPackage.jskit.runtime.server.providers, [
      { entrypoint: "src/server/MainServiceProvider.js", export: "MainServiceProvider" }
    ]);
    assert.deepEqual(localMainPackage.jskit.runtime.client.providers, [
      { entrypoint: "src/client/providers/MainClientProvider.js", export: "MainClientProvider" }
    ]);
    assert.equal(localMainPackage.jskit.metadata.jskit.ownershipGuidance.title, "App-local main lane");
    assert.ok(
      localMainPackage.jskit.metadata.jskit.ownershipGuidance.examples.includes(
        "jskit generate feature-server-generator scaffold booking-engine"
      )
    );

    const localMainClientEntrypoint = await readFile(path.join(appRoot, "packages/main/src/client/index.js"), "utf8");
    assert.match(localMainClientEntrypoint, /MainClientProvider/);
    assert.match(localMainClientEntrypoint, /registerMainClientComponent/);

    const localMainClientProvider = await readFile(
      path.join(appRoot, "packages/main/src/client/providers/MainClientProvider.js"),
      "utf8"
    );
    assert.match(localMainClientProvider, /class MainClientProvider/);
    assert.match(localMainClientProvider, /static id = "local\.main\.client";/);
    assert.match(localMainClientProvider, /import MenuLinkItem from "\/src\/components\/menus\/MenuLinkItem\.vue";/);
    assert.match(localMainClientProvider, /import SurfaceAwareMenuLinkItem from "\/src\/components\/menus\/SurfaceAwareMenuLinkItem\.vue";/);
    assert.match(localMainClientProvider, /import TabLinkItem from "\/src\/components\/menus\/TabLinkItem\.vue";/);
    assert.match(localMainClientProvider, /function registerMainClientComponent/);
    assert.match(localMainClientProvider, /mainClientComponents\.push\(\{ token, resolveComponent \}\);/);
    assert.match(localMainClientProvider, /for \(const \{ token, resolveComponent \} of mainClientComponents\)/);
    assert.match(localMainClientProvider, /registerMainClientComponent\("local\.main\.ui\.menu-link-item", \(\) => MenuLinkItem\);/);
    assert.match(localMainClientProvider, /registerMainClientComponent\("local\.main\.ui\.surface-aware-menu-link-item", \(\) => SurfaceAwareMenuLinkItem\);/);
    assert.match(localMainClientProvider, /registerMainClientComponent\("local\.main\.ui\.tab-link-item", \(\) => TabLinkItem\);/);
    assert.doesNotMatch(localMainClientProvider, /String\(componentToken \|\| ""\)\.trim\(\)/);
    assert.doesNotMatch(localMainClientProvider, /Object\.freeze\(\{\s*token,\s*resolveComponent\s*\}\)/);
    assert.doesNotMatch(localMainClientProvider, /requires application singleton/);

    const notFoundView = await readFile(path.join(appRoot, "src/views/NotFound.vue"), "utf8");
    assert.match(notFoundView, /The page you requested does not exist\./);

    await assert.rejects(access(path.join(appRoot, "src/pages/index.vue")), /ENOENT/);
    const homeView = await readFile(path.join(appRoot, "src/pages/home/index.vue"), "utf8");
    assert.match(homeView, /generated-ui-screen generated-ui-screen--app home-surface-screen/);
    assert.match(homeView, /--generated-ui-screen-title-size/);
    assert.match(homeView, /home-surface-screen/);
    assert.match(homeView, /Ready/);
    assert.match(homeView, /Core services are available\./);
    assert.doesNotMatch(homeView, /<v-card\b|Start by adding packages|Generate a page|install a package|Add product packages/);
    assert.doesNotMatch(homeView, /const appTitle =/);
    await access(path.join(appRoot, "src/components/ShellLayout.vue"));
    await access(path.join(appRoot, "src/components/menus/MenuLinkItem.vue"));
    await access(path.join(appRoot, "src/components/menus/SurfaceAwareMenuLinkItem.vue"));
    await access(path.join(appRoot, "src/components/menus/TabLinkItem.vue"));
    await access(path.join(appRoot, "src/error.js"));
    await access(path.join(appRoot, "src/placement.js"));
    await access(path.join(appRoot, "src/placementTopology.js"));
    await access(path.join(appRoot, "src/pages/home/settings.vue"));
    await access(path.join(appRoot, "src/pages/home/settings/general/index.vue"));
    await access(path.join(appRoot, "tests/e2e/adaptive-shell.spec.ts"));
    await assert.rejects(access(path.join(appRoot, "src/pages/console.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/console/index.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/app.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/admin.vue")), /ENOENT/);

    const viteConfig = await readFile(path.join(appRoot, "vite.config.mjs"), "utf8");
    assert.doesNotMatch(viteConfig, /function reparentNestedChildrenToIndexOwners\(rootRoute\)/);
    assert.doesNotMatch(viteConfig, /^\s*beforeWriteFiles:\s*reparentNestedChildrenToIndexOwners/m);
    assert.match(viteConfig, /nestedChildren: false/);
    assert.match(viteConfig, /Generated on the first Vite dev\/build scan and intentionally gitignored/);
    assert.doesNotMatch(viteConfig, /dedupe:\s*\[/);
    assert.match(viteConfig, /optimizeDeps:\s*\{/);
    assert.match(viteConfig, /entries:\s*\[/);
    assert.match(viteConfig, /"src\/\*\*\/\*\.\{js,ts,vue\}"/);
    assert.match(viteConfig, /warmup:\s*\{/);
    assert.match(viteConfig, /clientFiles:\s*\[/);
    assert.match(viteConfig, /"src\/pages\/\*\*\/\*\.\{js,ts,vue\}"/);

    assert.doesNotMatch(result.stdout, /Then add framework capabilities:/);
    assert.doesNotMatch(result.stdout, /npx jskit add package auth-provider-supabase-core/);
    assert.doesNotMatch(result.stdout, /npx jskit add bundle auth-base/);
    assert.doesNotMatch(result.stdout, /npx jskit add bundle auth-local/);
  });
});

test("create-app scaffolds ai-seed as a single AGENTS file with seed guidance", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const result = runCli({ cwd, args: ["seed-app", "--template", "ai-seed"] });

    assert.equal(result.status, 0, result.stderr);

    const appRoot = path.join(cwd, "seed-app");
    const entries = (await readdir(appRoot)).sort();
    assert.deepEqual(entries, ["AGENTS.md"]);

    const body = await readFile(path.join(appRoot, "AGENTS.md"), "utf8");
    assert.match(body, /only a JSKIT seed scaffold/);
    assert.doesNotMatch(body, /DB_PASSWORD/);
    assert.doesNotMatch(body, /OPENAI_API_KEY/);
    assert.doesNotMatch(body, /target database already exists/);
    assert.match(body, /create-app <app-name> --target \. --force --tenancy-mode <mode>/);

    assert.match(result.stdout, /Created app "seed-app" from template "ai-seed"/);
    assert.match(result.stdout, /follow the generated AGENTS\.md/);
    assert.doesNotMatch(result.stdout, /npm run dev/);
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

test("generated app agent wrappers point to the canonical JSKIT database contract", async () => {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const templateName of ["base-shell", "minimal-shell"]) {
    const wrapperPath = path.join(packageRoot, `templates/${templateName}/AGENTS.md`);
    const body = await readFile(wrapperPath, "utf8");
    assert.doesNotMatch(body, /Development\/current\/jskit-ai/);
    assert.match(body, /agent-docs\/guide\/agent\/index\.md/);
    assert.match(body, /agent-docs\/patterns\/crud-scaffolding\.md/);
    assert.doesNotMatch(body, /optional agent docs/);
    assert.doesNotMatch(body, /If dependencies are not installed yet/);
    assert.doesNotMatch(body, /node_modules\/@jskit-ai\/agent-docs\/templates\/app\/AGENTS\.md/);
  }
});

test("ai-seed agent instructions do not hardcode machine-specific paths and point to JSKIT docs", async () => {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const wrapperPath = path.join(packageRoot, "templates/ai-seed/AGENTS.md");
  const body = await readFile(wrapperPath, "utf8");
  assert.doesNotMatch(body, /Development\/current\/jskit-ai/);
  assert.match(body, /generated app `AGENTS\.md`/);
  assert.doesNotMatch(body, /github\.com\/mobily-enterprises\/jskit-ai\/blob\/main\/packages\/agent-docs\/site\/guide\/index\.md/);
  assert.doesNotMatch(body, /AUTH_SUPABASE_PUBLISHABLE_KEY/);
});

test("create-app interactive flow captures initial auth setup preset in guidance", async () => {
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
    assert.match(stdout, /npx jskit add package auth-provider-local-core/);
    assert.match(stdout, /npx jskit add package auth-web/);
    assert.doesNotMatch(stdout, /npx jskit add bundle auth-local/);
    assert.doesNotMatch(stdout, /auth-provider-supabase-core/);

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

test("create-app accepts the exact JSKIT-owned Playwright version", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const result = runCli({
      cwd,
      args: ["managed-browser-app", "--playwright-version", "1.61.1"]
    });

    assert.equal(result.status, 0, result.stderr);

    const packageJson = JSON.parse(await readFile(
      path.join(cwd, "managed-browser-app/package.json"),
      "utf8"
    ));
    assert.equal(packageJson.devDependencies["@playwright/test"], "1.61.1");
  });
});

test("create-app rejects a different exact Playwright version", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const result = runCli({
      cwd,
      args: ["unsupported-browser-app", "--playwright-version", "1.50.1"]
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JSKIT requires 1\.61\.1/u);
    await assert.rejects(access(path.join(cwd, "unsupported-browser-app")), /ENOENT/);
  });
});

test("create-app rejects floating Playwright versions", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const result = runCli({
      cwd,
      args: ["floating-browser-app", "--playwright-version", "^1.61.0"]
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JSKIT requires 1\.61\.1/u);
    await assert.rejects(access(path.join(cwd, "floating-browser-app")), /ENOENT/);
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
    assert.match(homeView, /generated-ui-screen generated-ui-screen--app home-surface-screen/);
    assert.match(homeView, /--generated-ui-screen-title-size/);
    assert.match(homeView, /home-surface-screen/);
    assert.match(homeView, /Core services are available\./);
    assert.doesNotMatch(homeView, /<v-card\b|Start by adding packages|Generate a page|install a package|Add product packages/);
  });
});

test("generated default shell app keeps the minimal runtime shape", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const createResult = runCli({ cwd, args: ["shell-only-app"] });
    assert.equal(createResult.status, 0, createResult.stderr);

    const appRoot = path.join(cwd, "shell-only-app");
    const procfile = await readFile(path.join(appRoot, "Procfile"), "utf8");
    assert.equal(procfile, "release: npm run db:migrate\nweb: npm run start\n");
    await assert.rejects(access(path.join(appRoot, "framework")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/app.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/admin.vue")), /ENOENT/);
    await assert.rejects(access(path.join(appRoot, "src/pages/console.vue")), /ENOENT/);

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

registryTest("create-app minimal mode keeps the bare scaffold and can still install shell-web", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const createResult = runCli({ cwd, args: ["minimal-app", "--minimal"] });
    assert.equal(createResult.status, 0, createResult.stderr);

    const appRoot = path.join(cwd, "minimal-app");
    const packageJsonBefore = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(packageJsonBefore.engines.node, "26.x");
    assert.deepEqual(packageJsonBefore.allowScripts, {
      "fsevents@2.3.2": true,
      "fsevents@2.3.3": true,
      "vue-demi@0.14.10": true
    });
    assert.equal(await readFile(path.join(appRoot, ".nvmrc"), "utf8"), "26\n");
    await assert.rejects(
      access(path.join(appRoot, ".github", "workflows", "jskit-verify.yml")),
      /ENOENT/
    );
    assert.equal(packageJsonBefore.dependencies["@jskit-ai/shell-web"], undefined);
    assert.equal(packageJsonBefore.dependencies["json-rest-schema"], "^1.0.17");
    assert.equal(packageJsonBefore.dependencies["vue-router"], "^5.1.0");
    assert.equal(packageJsonBefore.dependencies["json-rest-schema"], "^1.0.17");
    assert.equal(packageJsonBefore.devDependencies["@playwright/test"], "1.61.1");
    assert.equal(packageJsonBefore.devDependencies.vite, "^8.2.1");
    const gitignoreBefore = await readFile(path.join(appRoot, ".gitignore"), "utf8");
    assert.match(gitignoreBefore, /src\/typed-router\.d\.ts/);
    await assert.rejects(access(path.join(appRoot, "src/typed-router.d.ts")), /ENOENT/);
    const viteConfigBefore = await readFile(path.join(appRoot, "vite.config.mjs"), "utf8");
    assert.match(viteConfigBefore, /Generated on the first Vite dev\/build scan and intentionally gitignored/);
    const playwrightConfigBefore = await readFile(path.join(appRoot, "playwright.config.mjs"), "utf8");
    assert.match(playwrightConfigBefore, /@jskit-ai\/jskit-cli\/test\/playwright/u);
    assert.match(playwrightConfigBefore, /defineConfig\(createJskitPlaywrightConfig\(\)\)/u);
    assert.doesNotMatch(playwrightConfigBefore, /PLAYWRIGHT_BASE_URL|webServer|4173/u);
    const e2eSmokeBefore = await readFile(path.join(appRoot, "tests/e2e/base-shell.spec.ts"), "utf8");
    assert.match(e2eSmokeBefore, /runGeneratedAppSmokeCase/u);
    assert.match(e2eSmokeBefore, /test\(`/u);
    assert.match(e2eSmokeBefore, /expectedText: "Home base"/u);
    assert.doesNotMatch(e2eSmokeBefore, /PLAYWRIGHT_BASE_URL|scrollWidth|390|768|1280/u);
    const homeViewBefore = await readFile(path.join(appRoot, "src/pages/home/index.vue"), "utf8");
    assert.match(homeViewBefore, /home-start-screen/);
    assert.match(homeViewBefore, /Home base/);
    await assert.rejects(access(path.join(appRoot, "src/components/ShellLayout.vue")), /ENOENT/);

    const addShellWebResult = runJskit({
      cwd: appRoot,
      args: ["add", "package", "shell-web"]
    });
    assert.equal(addShellWebResult.status, 0, addShellWebResult.stderr);

    const packageJsonAfter = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    const appVue = await readFile(path.join(appRoot, "src/App.vue"), "utf8");
    const homeViewAfter = await readFile(path.join(appRoot, "src/pages/home/index.vue"), "utf8");

    assert.match(packageJsonAfter.dependencies["@jskit-ai/shell-web"], /^\d+\.\d+\.\d+$/u);
    await access(path.join(appRoot, ".github", "workflows", "jskit-verify.yml"));
    assert.match(appVue, /ShellErrorHost/);
    assert.match(homeViewAfter, /home-surface-screen/);
    await access(path.join(appRoot, "src/components/ShellLayout.vue"));
    await access(path.join(appRoot, "tests/e2e/adaptive-shell.spec.ts"));
  });
});

registryTest("fresh app CRUD scaffolds encode explicit M3 action hierarchy and stable settings links", async () => {
  await withCreateAppTempDir(async (cwd) => {
    const createResult = runCli({ cwd, args: ["crud-ui-hierarchy-app"] });
    assert.equal(createResult.status, 0, createResult.stderr);

    const appRoot = path.join(cwd, "crud-ui-hierarchy-app");

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
    const listBulkActionsSource = await readFile(
      path.join(appRoot, "src/pages/home/settings/customers/listBulkActions.js"),
      "utf8"
    );
    const listFiltersSource = await readFile(path.join(appRoot, "src/pages/home/settings/customers/listFilters.js"), "utf8");
    const viewPageSource = await readFile(path.join(appRoot, "src/pages/home/settings/customers/[customerId]/index.vue"), "utf8");
    const newPageSource = await readFile(path.join(appRoot, "src/pages/home/settings/customers/new.vue"), "utf8");
    const editPageSource = await readFile(path.join(appRoot, "src/pages/home/settings/customers/[customerId]/edit.vue"), "utf8");
    const addEditFormSource = await readFile(
      path.join(appRoot, "src/components/home/settings/customers/CrudAddEditForm.vue"),
      "utf8"
    );
    await assert.rejects(
      access(path.join(appRoot, "src/pages/home/settings/customers/_components/CrudAddEditForm.vue")),
      /ENOENT/
    );
    const viteConfigSource = await readFile(path.join(appRoot, "vite.config.mjs"), "utf8");

    assert.match(placementSource, /target: "page\.section-nav"/);
    assert.match(placementSource, /owner: "home-settings"/);
    assert.match(placementSource, /kind: "link"/);
    assert.doesNotMatch(placementSource, /componentToken: "local\.main\.ui\.surface-aware-menu-link-item"/);
    assert.match(placementSource, /scopedSuffix: "\/settings\/customers"/);
    assert.doesNotMatch(placementSource, /to: "\.\/customers"/);
    assert.doesNotMatch(placementSource, /to: "\.\/general"/);

    assert.match(listPageSource, /CrudListScreen/);
    assert.match(listPageSource, /useCrudListScreen/);
    assert.match(listPageSource, /listBulkActions/);
    assert.match(listPageSource, /listFilters/);
    assert.match(listPageSource, /create-label="New Customer"/);
    assert.match(listPageSource, /No Customers yet/);
    assert.match(listPageSource, /Create the first Customer to start using this workflow\./);
    assert.match(listBulkActionsSource, /const listBulkActions = defineCrudListBulkActions\(\[\]\);/);
    assert.match(listFiltersSource, /const listFilters = defineCrudListFilters\(\{\}\);/);

    assert.match(viewPageSource, /CrudViewScreen/);
    assert.match(viewPageSource, /useCrudViewScreen/);

    assert.match(newPageSource, /<CrudAddEditForm/);
    assert.match(newPageSource, /:screen="screen"/);
    assert.match(
      newPageSource,
      /from "\/src\/components\/home\/settings\/customers\/CrudAddEditForm\.vue"/
    );

    assert.match(editPageSource, /<CrudAddEditForm/);
    assert.match(editPageSource, /:screen="screen"/);
    assert.match(
      editPageSource,
      /from "\/src\/components\/home\/settings\/customers\/CrudAddEditForm\.vue"/
    );

    assert.match(addEditFormSource, /CrudAddEditScreen/);
    assert.match(addEditFormSource, /#fields=/);
    assert.match(viteConfigSource, /routesFolder:\s*"src\/pages"/);
  });
});
