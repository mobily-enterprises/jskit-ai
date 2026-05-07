import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCliRunner } from "../../testUtils/runCli.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import {
  buildManagedDeepLinkIntentFilterBlock,
  injectManagedDeepLinkBlock
} from "../src/server/commandHandlers/mobileShellSupport.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);
const DEFAULT_ANDROID_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>

    </application>
</manifest>
`;

function buildSeedAndroidAppBuildGradle({
  packageName = "com.example.mobile",
  versionCode = 1,
  versionName = "1.0.0"
} = {}) {
  return `apply plugin: 'com.android.application'

android {
    namespace "${packageName}"
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "${packageName}"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode ${versionCode}
        versionName "${versionName}"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
    }
}
`;
}

function buildSeedAndroidStringsXml({
  appName = "Example Mobile",
  packageName = "com.example.mobile",
  customScheme = "examplemobile"
} = {}) {
  return `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">${appName}</string>
    <string name="title_activity_main">${appName}</string>
    <string name="package_name">${packageName}</string>
    <string name="custom_url_scheme">${customScheme}</string>
</resources>
`;
}

function buildSeedMainActivityJava(packageName = "com.example.mobile") {
  return `package ${packageName};

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`;
}

const DEFAULT_ANDROID_VARIABLES_GRADLE = `ext {
    minSdkVersion = 23
    compileSdkVersion = 35
    targetSdkVersion = 35
}
`;

function createManagedRecord(packageId, version) {
  return {
    packageId,
    version,
    source: {
      type: "packages-directory"
    },
    managed: {
      packageJson: {
        dependencies: {},
        devDependencies: {},
        scripts: {}
      },
      text: {},
      vite: {},
      files: [],
      migrations: []
    },
    options: {},
    installedAt: "2026-05-07T00:00:00.000Z"
  };
}

async function writeExecutable(filePath, source) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source, "utf8");
  await chmod(filePath, 0o755);
}

async function installFakeCommand(binDir, commandName, source) {
  const filePath = path.join(binDir, commandName);
  await writeExecutable(filePath, source);
  return filePath;
}

function buildTestEnv(binDir, logPath, extra = {}) {
  return {
    ...extra,
    TEST_LOG_PATH: logPath,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
  };
}

async function createMobileReadyApp(appRoot, {
  includeMobileConfig = true,
  includeDevlinksScript = false,
  assetMode = "bundled",
  appId = "com.example.mobile",
  appName = "Example Mobile",
  apiBaseUrl = "https://api.example.test",
  customScheme = "examplemobile",
  androidPackageName = "com.example.mobile",
  devServerUrl = ""
} = {}) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await mkdir(path.join(appRoot, ".jskit"), { recursive: true });
  await mkdir(path.join(appRoot, "node_modules", ".bin"), { recursive: true });

  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "example-mobile-app",
        version: "0.1.0",
        private: true,
        type: "module",
        ...(includeDevlinksScript
          ? {
              scripts: {
                devlinks: "jskit app link-local-packages"
              }
            }
          : {})
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(appRoot, "config", "public.js"),
    `export const config = {
  surfaceModeAll: "all",
  surfaceDefaultId: "home",
  surfaceDefinitions: {
    home: {
      id: "home",
      label: "Home",
      pagesRoot: "home",
      enabled: true,
      requiresAuth: false,
      requiresWorkspace: false,
      accessPolicyId: "public",
      origin: ""
    }
  }
${includeMobileConfig ? `,
  mobile: {
    enabled: true,
    strategy: "capacitor",
    appId: ${JSON.stringify(appId)},
    appName: ${JSON.stringify(appName)},
    assetMode: ${JSON.stringify(assetMode)},
    devServerUrl: ${JSON.stringify(devServerUrl)},
    apiBaseUrl: ${JSON.stringify(apiBaseUrl)},
    auth: {
      callbackPath: "/auth/login",
      customScheme: ${JSON.stringify(customScheme)},
      appLinkDomains: ["mobile.example.test"]
    },
    android: {
      packageName: ${JSON.stringify(androidPackageName)},
      minSdk: 26,
      targetSdk: 35,
      versionCode: 1,
      versionName: "1.0.0"
    }
  }` : ""}
};
`,
    "utf8"
  );

  await writeFile(
    path.join(appRoot, ".jskit", "lock.json"),
    `${JSON.stringify(
      {
        lockVersion: 1,
        installedPackages: {
          "@jskit-ai/kernel": createManagedRecord("@jskit-ai/kernel", "0.1.63"),
          "@jskit-ai/shell-web": createManagedRecord("@jskit-ai/shell-web", "0.1.62")
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function markPackageAsInstalled(appRoot, packageId, version = "0.1.0") {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.dependencies ||= {};
  packageJson.dependencies[packageId] = "0.x";
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  const lockPath = path.join(appRoot, ".jskit", "lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.installedPackages ||= {};
  lock.installedPackages[packageId] = createManagedRecord(packageId, version);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

async function seedInstalledCapacitorShell(appRoot, {
  appId = "com.example.mobile",
  appName = "Example Mobile",
  androidPackageName = appId,
  customScheme = "examplemobile",
  minSdk = 23,
  targetSdk = 35,
  versionCode = 1,
  versionName = "1.0.0",
  webDir = "dist",
  server = null
} = {}) {
  const manifestPath = path.join(appRoot, "android", "app", "src", "main", "AndroidManifest.xml");
  const buildGradlePath = path.join(appRoot, "android", "app", "build.gradle");
  const stringsPath = path.join(appRoot, "android", "app", "src", "main", "res", "values", "strings.xml");
  const mainActivityPath = path.join(
    appRoot,
    "android",
    "app",
    "src",
    "main",
    "java",
    ...androidPackageName.split("."),
    "MainActivity.java"
  );
  const variablesGradlePath = path.join(appRoot, "android", "variables.gradle");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const capacitorConfig = {
    appId,
    appName,
    webDir,
    plugins: {
      CapacitorHttp: {
        enabled: true
      }
    }
  };
  if (server && typeof server === "object") {
    capacitorConfig.server = server;
  }
  await writeFile(
    path.join(appRoot, "capacitor.config.json"),
    `${JSON.stringify(
      capacitorConfig,
      null,
      2
    )}\n`,
    "utf8"
  );
  await mkdir(path.dirname(buildGradlePath), { recursive: true });
  await mkdir(path.dirname(stringsPath), { recursive: true });
  await mkdir(path.dirname(mainActivityPath), { recursive: true });
  await writeFile(manifestPath, DEFAULT_ANDROID_MANIFEST, "utf8");
  await writeFile(
    buildGradlePath,
    buildSeedAndroidAppBuildGradle({
      packageName: androidPackageName,
      versionCode,
      versionName
    }),
    "utf8"
  );
  await writeFile(
    stringsPath,
    buildSeedAndroidStringsXml({
      appName,
      packageName: androidPackageName,
      customScheme
    }),
    "utf8"
  );
  await writeFile(mainActivityPath, buildSeedMainActivityJava(androidPackageName), "utf8");
  await writeFile(
    variablesGradlePath,
    `ext {
    minSdkVersion = ${minSdk}
    compileSdkVersion = ${targetSdk}
    targetSdkVersion = ${targetSdk}
}
`,
    "utf8"
  );
}

async function prepareFakeAndroidSdk(sdkRoot) {
  await mkdir(path.join(sdkRoot, "platforms", "android-35"), { recursive: true });
  await mkdir(path.join(sdkRoot, "build-tools", "34.0.0"), { recursive: true });
  await mkdir(path.join(sdkRoot, "licenses"), { recursive: true });
  await writeFile(path.join(sdkRoot, "licenses", "android-sdk-license"), "accepted\n", "utf8");
}

test("jskit mobile help reflects the implemented file names and dry-run scope", async () => {
  await withTempDir(async (cwd) => {
    const addHelp = runCli({
      cwd,
      args: ["mobile", "add", "help"]
    });
    const runHelp = runCli({
      cwd,
      args: ["mobile", "run", "help"]
    });

    assert.equal(addHelp.status, 0);
    assert.equal(runHelp.status, 0);
    assert.match(String(addHelp.stdout || ""), /capacitor\.config\.json/u);
    assert.doesNotMatch(String(addHelp.stdout || ""), /capacitor\.config\.ts/u);
    assert.match(String(runHelp.stdout || ""), /--dry-run/u);
    assert.match(String(runHelp.stdout || ""), /--target <device-id>/u);
  });
});

test("jskit mobile add capacitor installs the package, renders config files, and provisions android", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot, {
      assetMode: "dev_server",
      devServerUrl: "http://10.0.2.2:5173"
    });
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "add" && process.argv[3] === "android") {
  const manifestPath = path.join(process.cwd(), "android", "app", "src", "main", "AndroidManifest.xml");
  const buildGradlePath = path.join(process.cwd(), "android", "app", "build.gradle");
  const stringsPath = path.join(process.cwd(), "android", "app", "src", "main", "res", "values", "strings.xml");
  const mainActivityPath = path.join(process.cwd(), "android", "app", "src", "main", "java", "com", "example", "mobile", "MainActivity.java");
  const variablesGradlePath = path.join(process.cwd(), "android", "variables.gradle");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(buildGradlePath), { recursive: true });
  fs.mkdirSync(path.dirname(stringsPath), { recursive: true });
  fs.mkdirSync(path.dirname(mainActivityPath), { recursive: true });
  fs.writeFileSync(manifestPath, ${JSON.stringify(DEFAULT_ANDROID_MANIFEST)}, "utf8");
  fs.writeFileSync(buildGradlePath, ${JSON.stringify(buildSeedAndroidAppBuildGradle())}, "utf8");
  fs.writeFileSync(stringsPath, ${JSON.stringify(buildSeedAndroidStringsXml())}, "utf8");
  fs.writeFileSync(mainActivityPath, ${JSON.stringify(buildSeedMainActivityJava())}, "utf8");
  fs.writeFileSync(variablesGradlePath, ${JSON.stringify(DEFAULT_ANDROID_VARIABLES_GRADLE)}, "utf8");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "add", "capacitor"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));

    const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(packageJson.dependencies["@capacitor/core"], "^7.4.3");
    assert.equal(packageJson.dependencies["@capacitor/android"], "^7.4.3");
    assert.equal(packageJson.dependencies["@capacitor/app"], "^7.1.0");
    assert.equal(packageJson.dependencies["@jskit-ai/mobile-capacitor"], "0.x");
    assert.equal(packageJson.devDependencies["@capacitor/cli"], "^7.4.3");
    assert.equal(packageJson.scripts["mobile:dev:android"], "jskit mobile dev android");
    assert.equal(packageJson.scripts["mobile:devices:android"], "jskit mobile devices android");
    assert.equal(packageJson.scripts["mobile:sync:android"], "jskit mobile sync android");
    assert.equal(packageJson.scripts["mobile:tunnel:android"], "jskit mobile tunnel android");
    assert.equal(packageJson.scripts["mobile:restart:android"], "jskit mobile restart android");
    assert.equal(packageJson.scripts["mobile:run:android"], "jskit mobile run android");
    assert.equal(packageJson.scripts["mobile:build:web"], "npm run build");
    assert.equal(packageJson.scripts["mobile:build:android"], "jskit mobile build android");

    const capacitorConfig = JSON.parse(await readFile(path.join(appRoot, "capacitor.config.json"), "utf8"));
    assert.equal(capacitorConfig.appId, "com.example.mobile");
    assert.equal(capacitorConfig.appName, "Example Mobile");
    assert.equal(capacitorConfig.webDir, "dist");
    assert.equal(capacitorConfig.server.url, "http://10.0.2.2:5173/");
    assert.equal(capacitorConfig.server.cleartext, true);
    assert.equal(capacitorConfig.plugins.CapacitorHttp.enabled, true);

    const notesSource = await readFile(path.join(appRoot, ".jskit", "mobile-capacitor.md"), "utf8");
    assert.match(notesSource, /strategy: `capacitor`/);
    assert.match(notesSource, /custom scheme: `examplemobile`/);
    assert.match(notesSource, /app link domains: `mobile\.example\.test`/);

    const manifestSource = await readFile(
      path.join(appRoot, "android", "app", "src", "main", "AndroidManifest.xml"),
      "utf8"
    );
    assert.match(manifestSource, /jskit-mobile-capacitor:deep-links:start/);
    assert.match(manifestSource, /android:scheme="examplemobile"/);
    assert.match(manifestSource, /android:usesCleartextTraffic="true"/u);

    const buildGradleSource = await readFile(path.join(appRoot, "android", "app", "build.gradle"), "utf8");
    assert.match(buildGradleSource, /namespace "com\.example\.mobile"/u);
    assert.match(buildGradleSource, /applicationId "com\.example\.mobile"/u);
    assert.match(buildGradleSource, /versionName "1\.0\.0"/u);

    const stringsSource = await readFile(
      path.join(appRoot, "android", "app", "src", "main", "res", "values", "strings.xml"),
      "utf8"
    );
    assert.match(stringsSource, /<string name="custom_url_scheme">examplemobile<\/string>/u);

    const variablesGradleSource = await readFile(path.join(appRoot, "android", "variables.gradle"), "utf8");
    assert.match(variablesGradleSource, /minSdkVersion = 26/u);

    const mainActivitySource = await readFile(
      path.join(appRoot, "android", "app", "src", "main", "java", "com", "example", "mobile", "MainActivity.java"),
      "utf8"
    );
    assert.match(mainActivitySource, /^package com\.example\.mobile;/mu);

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    assert.ok(lock.installedPackages["@jskit-ai/mobile-capacitor"]);

    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "npm install",
      "cap add android"
    ]);
  });
});

test("jskit mobile add capacitor --dry-run previews without writing files or running npm/cap", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "add", "capacitor", "--dry-run"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    await assert.rejects(() => readFile(path.join(appRoot, "capacitor.config.json"), "utf8"));
    await assert.rejects(() => readFile(path.join(appRoot, ".jskit", "mobile-capacitor.md"), "utf8"));
    await assert.rejects(() => readFile(logPath, "utf8"));
  });
});

test("jskit mobile add capacitor appends a managed mobile config stub when config.mobile is missing", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot, {
      includeMobileConfig: false
    });
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "add" && process.argv[3] === "android") {
  const manifestPath = path.join(process.cwd(), "android", "app", "src", "main", "AndroidManifest.xml");
  const buildGradlePath = path.join(process.cwd(), "android", "app", "build.gradle");
  const stringsPath = path.join(process.cwd(), "android", "app", "src", "main", "res", "values", "strings.xml");
  const mainActivityPath = path.join(process.cwd(), "android", "app", "src", "main", "java", "com", "example", "mobile", "MainActivity.java");
  const variablesGradlePath = path.join(process.cwd(), "android", "variables.gradle");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(buildGradlePath), { recursive: true });
  fs.mkdirSync(path.dirname(stringsPath), { recursive: true });
  fs.mkdirSync(path.dirname(mainActivityPath), { recursive: true });
  fs.writeFileSync(manifestPath, ${JSON.stringify(DEFAULT_ANDROID_MANIFEST)}, "utf8");
  fs.writeFileSync(buildGradlePath, ${JSON.stringify(buildSeedAndroidAppBuildGradle())}, "utf8");
  fs.writeFileSync(stringsPath, ${JSON.stringify(buildSeedAndroidStringsXml())}, "utf8");
  fs.writeFileSync(mainActivityPath, ${JSON.stringify(buildSeedMainActivityJava())}, "utf8");
  fs.writeFileSync(variablesGradlePath, ${JSON.stringify(DEFAULT_ANDROID_VARIABLES_GRADLE)}, "utf8");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "add", "capacitor"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const publicConfigSource = await readFile(path.join(appRoot, "config", "public.js"), "utf8");
    assert.match(publicConfigSource, /jskit-mobile-capacitor:config:start/u);
    assert.match(publicConfigSource, /config\.mobile = \{/u);
    assert.match(publicConfigSource, /appId: "ai\.jskit\.example"/u);
    assert.match(publicConfigSource, /apiBaseUrl: "http:\/\/127\.0\.0\.1:3000"/u);
    assert.match(publicConfigSource, /customScheme: "example"/u);
  });
});

test("jskit mobile add capacitor runs devlinks after npm install only when --devlinks is passed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot, {
      includeDevlinksScript: true
    });
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "add" && process.argv[3] === "android") {
  const manifestPath = path.join(process.cwd(), "android", "app", "src", "main", "AndroidManifest.xml");
  const buildGradlePath = path.join(process.cwd(), "android", "app", "build.gradle");
  const stringsPath = path.join(process.cwd(), "android", "app", "src", "main", "res", "values", "strings.xml");
  const mainActivityPath = path.join(process.cwd(), "android", "app", "src", "main", "java", "com", "example", "mobile", "MainActivity.java");
  const variablesGradlePath = path.join(process.cwd(), "android", "variables.gradle");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(buildGradlePath), { recursive: true });
  fs.mkdirSync(path.dirname(stringsPath), { recursive: true });
  fs.mkdirSync(path.dirname(mainActivityPath), { recursive: true });
  fs.writeFileSync(manifestPath, ${JSON.stringify(DEFAULT_ANDROID_MANIFEST)}, "utf8");
  fs.writeFileSync(buildGradlePath, ${JSON.stringify(buildSeedAndroidAppBuildGradle())}, "utf8");
  fs.writeFileSync(stringsPath, ${JSON.stringify(buildSeedAndroidStringsXml())}, "utf8");
  fs.writeFileSync(mainActivityPath, ${JSON.stringify(buildSeedMainActivityJava())}, "utf8");
  fs.writeFileSync(variablesGradlePath, ${JSON.stringify(DEFAULT_ANDROID_VARIABLES_GRADLE)}, "utf8");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "add", "capacitor", "--devlinks"],
      env: buildTestEnv(binDir, logPath, {
        JSKIT_REPO_ROOT: "/home/merc/Development/current/jskit-ai"
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "npm install",
      "npm run --if-present devlinks",
      "cap add android"
    ]);
  });
});

test("jskit add package @jskit-ai/mobile-capacitor installs through hooks with config seeding and standard npm install by default", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot, {
      includeMobileConfig: false,
      includeDevlinksScript: true
    });
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "add" && process.argv[3] === "android") {
  const manifestPath = path.join(process.cwd(), "android", "app", "src", "main", "AndroidManifest.xml");
  const buildGradlePath = path.join(process.cwd(), "android", "app", "build.gradle");
  const stringsPath = path.join(process.cwd(), "android", "app", "src", "main", "res", "values", "strings.xml");
  const mainActivityPath = path.join(process.cwd(), "android", "app", "src", "main", "java", "com", "example", "mobile", "MainActivity.java");
  const variablesGradlePath = path.join(process.cwd(), "android", "variables.gradle");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(buildGradlePath), { recursive: true });
  fs.mkdirSync(path.dirname(stringsPath), { recursive: true });
  fs.mkdirSync(path.dirname(mainActivityPath), { recursive: true });
  fs.writeFileSync(manifestPath, ${JSON.stringify(DEFAULT_ANDROID_MANIFEST)}, "utf8");
  fs.writeFileSync(buildGradlePath, ${JSON.stringify(buildSeedAndroidAppBuildGradle())}, "utf8");
  fs.writeFileSync(stringsPath, ${JSON.stringify(buildSeedAndroidStringsXml())}, "utf8");
  fs.writeFileSync(mainActivityPath, ${JSON.stringify(buildSeedMainActivityJava())}, "utf8");
  fs.writeFileSync(variablesGradlePath, ${JSON.stringify(DEFAULT_ANDROID_VARIABLES_GRADLE)}, "utf8");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["add", "package", "@jskit-ai/mobile-capacitor"],
      env: buildTestEnv(binDir, logPath, {
        JSKIT_REPO_ROOT: "/home/merc/Development/current/jskit-ai"
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const publicConfigSource = await readFile(path.join(appRoot, "config", "public.js"), "utf8");
    assert.match(publicConfigSource, /jskit-mobile-capacitor:config:start/u);
    assert.match(publicConfigSource, /appId: "ai\.jskit\.example"/u);
    assert.match(publicConfigSource, /apiBaseUrl: "http:\/\/127\.0\.0\.1:3000"/u);
    assert.match(publicConfigSource, /customScheme: "example"/u);

    const manifestSource = await readFile(path.join(appRoot, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
    assert.match(manifestSource, /android:scheme="example"/u);

    const buildGradleSource = await readFile(path.join(appRoot, "android", "app", "build.gradle"), "utf8");
    assert.match(buildGradleSource, /namespace "ai\.jskit\.example"/u);

    const stringsSource = await readFile(
      path.join(appRoot, "android", "app", "src", "main", "res", "values", "strings.xml"),
      "utf8"
    );
    assert.match(stringsSource, /<string name="custom_url_scheme">example<\/string>/u);

    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "npm install",
      "cap add android"
    ]);
  });
});

test("jskit add package @jskit-ai/mobile-capacitor --dry-run previews the managed config stub when config.mobile is missing", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");

    await createMobileReadyApp(appRoot, {
      includeMobileConfig: false
    });

    const result = runCli({
      cwd: appRoot,
      args: ["add", "package", "@jskit-ai/mobile-capacitor", "--dry-run"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const publicConfigSource = await readFile(path.join(appRoot, "config", "public.js"), "utf8");
    assert.doesNotMatch(publicConfigSource, /jskit-mobile-capacitor:config:start/u);
    assert.match(String(result.stdout || ""), /append managed mobile config/u);
    assert.match(String(result.stdout || ""), /preview stops after the config\.mobile stub/u);
  });
});

test("jskit add package @jskit-ai/mobile-capacitor reprovisions a partial Android shell and prints the long-running steps", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot, {
      includeDevlinksScript: true
    });
    await mkdir(path.join(appRoot, "android", "app", "src", "main"), { recursive: true });

    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "add" && process.argv[3] === "android") {
  const manifestPath = path.join(process.cwd(), "android", "app", "src", "main", "AndroidManifest.xml");
  const buildGradlePath = path.join(process.cwd(), "android", "app", "build.gradle");
  const stringsPath = path.join(process.cwd(), "android", "app", "src", "main", "res", "values", "strings.xml");
  const mainActivityPath = path.join(process.cwd(), "android", "app", "src", "main", "java", "com", "example", "mobile", "MainActivity.java");
  const variablesGradlePath = path.join(process.cwd(), "android", "variables.gradle");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(buildGradlePath), { recursive: true });
  fs.mkdirSync(path.dirname(stringsPath), { recursive: true });
  fs.mkdirSync(path.dirname(mainActivityPath), { recursive: true });
  fs.writeFileSync(manifestPath, ${JSON.stringify(DEFAULT_ANDROID_MANIFEST)}, "utf8");
  fs.writeFileSync(buildGradlePath, ${JSON.stringify(buildSeedAndroidAppBuildGradle())}, "utf8");
  fs.writeFileSync(stringsPath, ${JSON.stringify(buildSeedAndroidStringsXml())}, "utf8");
  fs.writeFileSync(mainActivityPath, ${JSON.stringify(buildSeedMainActivityJava())}, "utf8");
  fs.writeFileSync(variablesGradlePath, ${JSON.stringify(DEFAULT_ANDROID_VARIABLES_GRADLE)}, "utf8");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["add", "package", "@jskit-ai/mobile-capacitor"],
      env: buildTestEnv(binDir, logPath, {
        JSKIT_REPO_ROOT: "/home/merc/Development/current/jskit-ai"
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Installing app dependencies for the mobile shell:/u);
    assert.match(String(result.stdout || ""), /\$ npm install\s*\n/u);
    assert.doesNotMatch(String(result.stdout || ""), /npm install --no-save/u);
    assert.match(String(result.stdout || ""), /Android shell is partial or stale\. Reprovisioning it with Capacitor CLI/u);
    assert.match(String(result.stdout || ""), /android\/ exists but contains no files\. Removing the empty partial shell before reprovisioning\./u);
    assert.match(String(result.stdout || ""), /\$ cap add android/u);

    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "npm install",
      "cap add android"
    ]);
  });
});

test("jskit add package @jskit-ai/mobile-capacitor reapplies lifecycle hooks for an already-installed partial shell", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot, {
      includeDevlinksScript: true
    });
    await markPackageAsInstalled(appRoot, "@jskit-ai/mobile-capacitor", "0.1.0");
    await mkdir(path.join(appRoot, "android", "app", "src", "main"), { recursive: true });

    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "add" && process.argv[3] === "android") {
  const manifestPath = path.join(process.cwd(), "android", "app", "src", "main", "AndroidManifest.xml");
  const buildGradlePath = path.join(process.cwd(), "android", "app", "build.gradle");
  const stringsPath = path.join(process.cwd(), "android", "app", "src", "main", "res", "values", "strings.xml");
  const mainActivityPath = path.join(process.cwd(), "android", "app", "src", "main", "java", "com", "example", "mobile", "MainActivity.java");
  const variablesGradlePath = path.join(process.cwd(), "android", "variables.gradle");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(buildGradlePath), { recursive: true });
  fs.mkdirSync(path.dirname(stringsPath), { recursive: true });
  fs.mkdirSync(path.dirname(mainActivityPath), { recursive: true });
  fs.writeFileSync(manifestPath, ${JSON.stringify(DEFAULT_ANDROID_MANIFEST)}, "utf8");
  fs.writeFileSync(buildGradlePath, ${JSON.stringify(buildSeedAndroidAppBuildGradle())}, "utf8");
  fs.writeFileSync(stringsPath, ${JSON.stringify(buildSeedAndroidStringsXml())}, "utf8");
  fs.writeFileSync(mainActivityPath, ${JSON.stringify(buildSeedMainActivityJava())}, "utf8");
  fs.writeFileSync(variablesGradlePath, ${JSON.stringify(DEFAULT_ANDROID_VARIABLES_GRADLE)}, "utf8");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["add", "package", "@jskit-ai/mobile-capacitor"],
      env: buildTestEnv(binDir, logPath, {
        JSKIT_REPO_ROOT: "/home/merc/Development/current/jskit-ai"
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Android shell is partial or stale\. Reprovisioning it with Capacitor CLI/u);
    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "npm install",
      "cap add android"
    ]);
  });
});

test("jskit mobile add capacitor --dry-run previews the managed config stub when config.mobile is missing", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");

    await createMobileReadyApp(appRoot, {
      includeMobileConfig: false
    });

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "add", "capacitor", "--dry-run"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const publicConfigSource = await readFile(path.join(appRoot, "config", "public.js"), "utf8");
    assert.doesNotMatch(publicConfigSource, /jskit-mobile-capacitor:config:start/u);
    assert.match(String(result.stdout || ""), /append managed mobile config/u);
  });
});

test("jskit mobile sync android builds the app and syncs the Android shell", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot);
    await seedInstalledCapacitorShell(appRoot);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "run" && process.argv[3] === "build") {
  const distDir = path.join(process.cwd(), "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>\\n", "utf8");
}
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "sync" && process.argv[3] === "android") {
  const distDir = path.join(process.cwd(), "dist");
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    process.stderr.write("dist build output missing\\n");
    process.exit(1);
  }
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "sync", "android"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.equal(
      await readFile(path.join(appRoot, "dist", "index.html"), "utf8"),
      "<html></html>\n"
    );
    const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(packageJson.dependencies["@capacitor/browser"], "^7.0.1");

    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "npm install",
      "npm run build",
      "cap sync android"
    ]);

    const manifestSource = await readFile(
      path.join(appRoot, "android", "app", "src", "main", "AndroidManifest.xml"),
      "utf8"
    );
    assert.match(manifestSource, /jskit-mobile-capacitor:deep-links:start/);
    assert.match(manifestSource, /android:scheme="examplemobile"/);
  });
});

test("jskit mobile sync android refreshes stale managed shell files from config.mobile", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot, {
      appId: "ai.jskit.exampleapp",
      appName: "Example App",
      apiBaseUrl: "https://api.example.test",
      androidPackageName: "ai.jskit.exampleapp"
    });
    await markPackageAsInstalled(appRoot, "@jskit-ai/mobile-capacitor");
    await seedInstalledCapacitorShell(appRoot, {
      appId: "com.example.mobile",
      appName: "Stale Mobile"
    });
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "run" && process.argv[3] === "build") {
  const distDir = path.join(process.cwd(), "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>\\n", "utf8");
}
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "sync", "android"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));

    const capacitorConfig = JSON.parse(await readFile(path.join(appRoot, "capacitor.config.json"), "utf8"));
    assert.equal(capacitorConfig.appId, "ai.jskit.exampleapp");
    assert.equal(capacitorConfig.appName, "Example App");
    assert.equal(capacitorConfig.plugins.CapacitorHttp.enabled, true);

    const notesSource = await readFile(path.join(appRoot, ".jskit", "mobile-capacitor.md"), "utf8");
    assert.match(notesSource, /Capacitor app id: `ai\.jskit\.exampleapp`/u);
    assert.match(notesSource, /API base URL: `https:\/\/api\.example\.test\/`/u);

    const buildGradleSource = await readFile(path.join(appRoot, "android", "app", "build.gradle"), "utf8");
    assert.match(buildGradleSource, /namespace "ai\.jskit\.exampleapp"/u);
    assert.match(buildGradleSource, /applicationId "ai\.jskit\.exampleapp"/u);

    const stringsSource = await readFile(
      path.join(appRoot, "android", "app", "src", "main", "res", "values", "strings.xml"),
      "utf8"
    );
    assert.match(stringsSource, /<string name="app_name">Example App<\/string>/u);
    assert.match(stringsSource, /<string name="package_name">ai\.jskit\.exampleapp<\/string>/u);

    const newMainActivityPath = path.join(
      appRoot,
      "android",
      "app",
      "src",
      "main",
      "java",
      "ai",
      "jskit",
      "exampleapp",
      "MainActivity.java"
    );
    const newMainActivitySource = await readFile(newMainActivityPath, "utf8");
    assert.match(newMainActivitySource, /^package ai\.jskit\.exampleapp;/mu);
    await assert.rejects(() => readFile(
      path.join(appRoot, "android", "app", "src", "main", "java", "com", "example", "mobile", "MainActivity.java"),
      "utf8"
    ));
  });
});

test("jskit mobile sync android enables Android cleartext traffic when apiBaseUrl uses http", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot, {
      appId: "ai.jskit.exampleapp",
      appName: "Example App",
      apiBaseUrl: "http://127.0.0.1:3000",
      androidPackageName: "ai.jskit.exampleapp"
    });
    await markPackageAsInstalled(appRoot, "@jskit-ai/mobile-capacitor");
    await seedInstalledCapacitorShell(appRoot, {
      appId: "ai.jskit.exampleapp",
      appName: "Example App"
    });
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "run" && process.argv[3] === "build") {
  const distDir = path.join(process.cwd(), "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>\\n", "utf8");
}
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "sync", "android"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const manifestSource = await readFile(
      path.join(appRoot, "android", "app", "src", "main", "AndroidManifest.xml"),
      "utf8"
    );
    assert.match(manifestSource, /android:usesCleartextTraffic="true"/u);
  });
});

test("jskit mobile sync android --dry-run previews commands without building or syncing", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot);
    await seedInstalledCapacitorShell(appRoot);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "sync", "android", "--dry-run"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    await assert.rejects(() => readFile(path.join(appRoot, "dist", "index.html"), "utf8"));
    await assert.rejects(() => readFile(logPath, "utf8"));
    assert.match(String(result.stdout || ""), /\[dry-run\] npm run build/u);
    assert.match(String(result.stdout || ""), /\[dry-run\] cap sync android/u);
  });
});

test("jskit mobile devices android lists adb-visible Android targets", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot);
    await installFakeCommand(
      binDir,
      "adb",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["adb", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "devices" && process.argv[3] === "-l") {
  process.stdout.write("List of devices attached\\n");
  process.stdout.write("8ADX0QUH3\\tdevice usb:1-1 product:oriole model:Pixel_6 device:oriole transport_id:5\\n");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "devices", "android"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Android devices:/u);
    assert.match(String(result.stdout || ""), /8ADX0QUH3 device usb:1-1/u);
    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "adb devices -l"
    ]);
  });
});

test("jskit mobile tunnel android infers the reverse port from config.mobile.apiBaseUrl and uses the first device when --target is omitted", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot, {
      apiBaseUrl: "http://127.0.0.1:3000"
    });
    await installFakeCommand(
      binDir,
      "adb",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["adb", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "devices" && process.argv[3] === "-l") {
  process.stdout.write("List of devices attached\\n");
  process.stdout.write("8ADX0QUH3\\tdevice usb:1-1 product:oriole model:Pixel_6 device:oriole transport_id:5\\n");
  process.exit(0);
}
if (process.argv[2] === "-s" && process.argv[4] === "reverse" && process.argv[5] === "--list") {
  process.stdout.write("UsbFfs tcp:3000 tcp:3000\\n");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "tunnel", "android"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Android reverse tunnel ready for 8ADX0QUH3: tcp:3000 -> tcp:3000/u);
    assert.match(String(result.stdout || ""), /UsbFfs tcp:3000 tcp:3000/u);
    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "adb devices -l",
      "adb -s 8ADX0QUH3 reverse tcp:3000 tcp:3000",
      "adb -s 8ADX0QUH3 reverse --list"
    ]);
  });
});

test("jskit mobile dev android uses the first adb device when --target is omitted", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    const sdkRoot = path.join(cwd, "android-sdk");

    await createMobileReadyApp(appRoot, {
      apiBaseUrl: "http://127.0.0.1:3000"
    });
    await seedInstalledCapacitorShell(appRoot);
    await prepareFakeAndroidSdk(sdkRoot);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "run" && process.argv[3] === "build") {
  const distDir = path.join(process.cwd(), "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>\\n", "utf8");
}
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "sync" && process.argv[3] === "android") {
  const distDir = path.join(process.cwd(), "dist");
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    process.stderr.write("dist build output missing\\n");
    process.exit(1);
  }
}
`
    );
    await installFakeCommand(
      binDir,
      "adb",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["adb", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "devices" && process.argv[3] === "-l") {
  process.stdout.write("List of devices attached\\n");
  process.stdout.write("8ADX0QUH3\\tdevice usb:1-1 product:oriole model:Pixel_6 device:oriole transport_id:5\\n");
  process.stdout.write("emulator-5554\\tdevice product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:6\\n");
  process.exit(0);
}
if (process.argv[2] === "-s" && process.argv[4] === "reverse" && process.argv[5] === "--list") {
  process.stdout.write("UsbFfs tcp:3000 tcp:3000\\n");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "dev", "android"],
      env: buildTestEnv(binDir, logPath, {
        ANDROID_HOME: sdkRoot
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Using Android device: 8ADX0QUH3/u);
    assert.match(String(result.stdout || ""), /Building and syncing the Android shell:/u);
    assert.match(String(result.stdout || ""), /npx jskit mobile sync android/u);
    assert.match(String(result.stdout || ""), /npx jskit mobile run android --target 8ADX0QUH3/u);
    assert.match(String(result.stdout || ""), /npx jskit mobile tunnel android --target 8ADX0QUH3/u);
    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "adb devices -l",
      "npm install",
      "npm run build",
      "cap sync android",
      "cap run android --target 8ADX0QUH3",
      "adb devices -l",
      "adb -s 8ADX0QUH3 reverse tcp:3000 tcp:3000",
      "adb -s 8ADX0QUH3 reverse --list"
    ]);
  });
});

test("jskit mobile dev android respects an explicit --target override", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    const sdkRoot = path.join(cwd, "android-sdk");

    await createMobileReadyApp(appRoot, {
      apiBaseUrl: "http://127.0.0.1:3000"
    });
    await seedInstalledCapacitorShell(appRoot);
    await prepareFakeAndroidSdk(sdkRoot);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "run" && process.argv[3] === "build") {
  const distDir = path.join(process.cwd(), "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>\\n", "utf8");
}
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "sync" && process.argv[3] === "android") {
  const distDir = path.join(process.cwd(), "dist");
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    process.stderr.write("dist build output missing\\n");
    process.exit(1);
  }
}
`
    );
    await installFakeCommand(
      binDir,
      "adb",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["adb", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "devices" && process.argv[3] === "-l") {
  process.stdout.write("List of devices attached\\n");
  process.stdout.write("first-device\\tdevice usb:1-1 transport_id:5\\n");
  process.stdout.write("chosen-device\\tdevice usb:1-2 transport_id:6\\n");
  process.exit(0);
}
if (process.argv[2] === "-s" && process.argv[4] === "reverse" && process.argv[5] === "--list") {
  process.stdout.write("UsbFfs tcp:3000 tcp:3000\\n");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "dev", "android", "--target", "chosen-device"],
      env: buildTestEnv(binDir, logPath, {
        ANDROID_HOME: sdkRoot
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Using Android device: chosen-device/u);
    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "adb devices -l",
      "npm install",
      "npm run build",
      "cap sync android",
      "cap run android --target chosen-device",
      "adb devices -l",
      "adb -s chosen-device reverse tcp:3000 tcp:3000",
      "adb -s chosen-device reverse --list"
    ]);
  });
});

test("jskit mobile restart android clears app data and cold-starts MainActivity on the first device when --target is omitted", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");

    await createMobileReadyApp(appRoot, {
      appId: "ai.jskit.exampleapp",
      androidPackageName: "ai.jskit.exampleapp"
    });
    await installFakeCommand(
      binDir,
      "adb",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["adb", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "devices" && process.argv[3] === "-l") {
  process.stdout.write("List of devices attached\\n");
  process.stdout.write("8ADX0QUH3\\tdevice usb:1-1 product:oriole model:Pixel_6 device:oriole transport_id:5\\n");
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "restart", "android"],
      env: buildTestEnv(binDir, logPath)
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Android app restarted on 8ADX0QUH3: ai\.jskit\.exampleapp/u);
    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "adb devices -l",
      "adb -s 8ADX0QUH3 shell pm clear ai.jskit.exampleapp",
      "adb -s 8ADX0QUH3 shell am force-stop ai.jskit.exampleapp",
      "adb -s 8ADX0QUH3 shell am start -W -n ai.jskit.exampleapp/.MainActivity"
    ]);
  });
});

test("jskit mobile run android syncs bundled apps before launching the Android shell", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    const sdkRoot = path.join(cwd, "android-sdk");

    await createMobileReadyApp(appRoot);
    await seedInstalledCapacitorShell(appRoot);
    await prepareFakeAndroidSdk(sdkRoot);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "run" && process.argv[3] === "build") {
  const distDir = path.join(process.cwd(), "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>\\n", "utf8");
}
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "sync" && process.argv[3] === "android") {
  const distDir = path.join(process.cwd(), "dist");
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    process.stderr.write("dist build output missing\\n");
    process.exit(1);
  }
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "run", "android"],
      env: buildTestEnv(binDir, logPath, {
        ANDROID_HOME: sdkRoot
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "npm install",
      "npm run build",
      "cap sync android",
      "cap run android"
    ]);
  });
});

test("jskit mobile run android uses the configured dev server without rebuilding bundled assets", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    const sdkRoot = path.join(cwd, "android-sdk");

    await createMobileReadyApp(appRoot, {
      assetMode: "dev_server",
      devServerUrl: "http://10.0.2.2:5173"
    });
    await seedInstalledCapacitorShell(appRoot, {
      server: {
        url: "http://10.0.2.2:5173/",
        cleartext: true
      }
    });
    await prepareFakeAndroidSdk(sdkRoot);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "run", "android"],
      env: buildTestEnv(binDir, logPath, {
        ANDROID_HOME: sdkRoot
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "npm install",
      "cap sync android",
      "cap run android"
    ]);
  });
});

test("jskit mobile run android forwards --target to cap run android", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    const sdkRoot = path.join(cwd, "android-sdk");

    await createMobileReadyApp(appRoot);
    await seedInstalledCapacitorShell(appRoot);
    await prepareFakeAndroidSdk(sdkRoot);
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "run" && process.argv[3] === "build") {
  const distDir = path.join(process.cwd(), "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>\\n", "utf8");
}
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "sync" && process.argv[3] === "android") {
  const distDir = path.join(process.cwd(), "dist");
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    process.stderr.write("dist build output missing\\n");
    process.exit(1);
  }
}
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "run", "android", "--target", "8ADX0QUH3"],
      env: buildTestEnv(binDir, logPath, {
        ANDROID_HOME: sdkRoot
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "npm install",
      "npm run build",
      "cap sync android",
      "cap run android --target 8ADX0QUH3"
    ]);
  });
});

test("jskit mobile build android runs the release Gradle bundle task for bundled assets", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    const sdkRoot = path.join(cwd, "android-sdk");

    await createMobileReadyApp(appRoot);
    await seedInstalledCapacitorShell(appRoot);
    await prepareFakeAndroidSdk(sdkRoot);
    await writeExecutable(
      path.join(appRoot, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew"),
      process.platform === "win32"
        ? `@echo off
echo gradlew %*>> "%TEST_LOG_PATH%"
`
        : `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.TEST_LOG_PATH, ["gradlew", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );
    await installFakeCommand(
      binDir,
      "npm",
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
if (process.argv[2] === "run" && process.argv[3] === "build") {
  const distDir = path.join(process.cwd(), "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>\\n", "utf8");
}
`
    );
    await writeExecutable(
      path.join(appRoot, "node_modules", ".bin", "cap"),
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LOG_PATH, ["cap", ...process.argv.slice(2)].join(" ") + "\\n");
`
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "build", "android"],
      env: buildTestEnv(binDir, logPath, {
        ANDROID_HOME: sdkRoot
      })
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const logLines = (await readFile(logPath, "utf8")).split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(logLines, [
      "npm install",
      "npm run build",
      "cap sync android",
      "gradlew bundleRelease"
    ]);
  });
});

test("jskit mobile doctor validates the managed shell files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const sdkRoot = path.join(cwd, "android-sdk");

    await createMobileReadyApp(appRoot, {
      appId: "ai.jskit.exampleapp",
      apiBaseUrl: "https://api.example.test",
      androidPackageName: "ai.jskit.exampleapp"
    });
    await seedInstalledCapacitorShell(appRoot, {
      appId: "ai.jskit.exampleapp",
      appName: "Example Mobile",
      minSdk: 26
    });
    await prepareFakeAndroidSdk(sdkRoot);
    await writeFile(
      path.join(appRoot, "android", "app", "src", "main", "AndroidManifest.xml"),
      injectManagedDeepLinkBlock(
        DEFAULT_ANDROID_MANIFEST,
        buildManagedDeepLinkIntentFilterBlock({
          auth: {
            customScheme: "examplemobile"
          }
        })
      ),
      "utf8"
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "doctor"],
      env: {
        ...process.env,
        ANDROID_HOME: sdkRoot
      }
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /looks healthy/u);
  });
});

test("jskit mobile doctor reports stale managed mobile-shell files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const sdkRoot = path.join(cwd, "android-sdk");

    await createMobileReadyApp(appRoot, {
      appId: "ai.jskit.exampleapp",
      apiBaseUrl: "http://127.0.0.1:3000",
      androidPackageName: "ai.jskit.exampleapp"
    });
    await seedInstalledCapacitorShell(appRoot, {
      appId: "com.example.mobile",
      appName: "Stale Mobile"
    });
    await prepareFakeAndroidSdk(sdkRoot);
    await writeFile(
      path.join(appRoot, ".jskit", "mobile-capacitor.md"),
      "# stale notes\n",
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "android", "app", "src", "main", "AndroidManifest.xml"),
      DEFAULT_ANDROID_MANIFEST.replace(
        "</activity>",
        `            <!-- jskit-mobile-capacitor:deep-links:start -->\n            <intent-filter>\n                <action android:name=\"android.intent.action.VIEW\" />\n                <category android:name=\"android.intent.category.DEFAULT\" />\n                <category android:name=\"android.intent.category.BROWSABLE\" />\n                <data android:scheme=\"examplemobile\" />\n            </intent-filter>\n            <!-- jskit-mobile-capacitor:deep-links:end -->\n\n        </activity>`
      ),
      "utf8"
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "doctor"],
      env: {
        ...process.env,
        ANDROID_HOME: sdkRoot
      }
    });

    assert.equal(result.status, 1, "doctor should fail when managed files are stale");
    assert.match(String(result.stdout || ""), /capacitor\.config\.json is stale/u);
    assert.match(String(result.stdout || ""), /mobile-capacitor\.md is stale/u);
    assert.match(String(result.stdout || ""), /AndroidManifest\.xml is stale/u);
  });
});

test("jskit mobile doctor reports missing Android SDK components for the generated shell", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const sdkRoot = path.join(cwd, "android-sdk");

    await createMobileReadyApp(appRoot, {
      appId: "ai.jskit.exampleapp",
      apiBaseUrl: "https://api.example.test",
      androidPackageName: "ai.jskit.exampleapp"
    });
    await seedInstalledCapacitorShell(appRoot, {
      appId: "ai.jskit.exampleapp",
      appName: "Example Mobile",
      minSdk: 26
    });
    await mkdir(sdkRoot, { recursive: true });

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "doctor"],
      env: {
        ...process.env,
        ANDROID_HOME: sdkRoot
      }
    });

    assert.equal(result.status, 1, "doctor should fail when required Android SDK components are missing");
    assert.match(String(result.stdout || ""), /platform android-35 is missing/u);
    assert.match(String(result.stdout || ""), /build-tools/u);
  });
});

test("jskit mobile doctor reports invalid mobile config instead of silently falling back", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");

    await createMobileReadyApp(appRoot, {
      assetMode: "devserver"
    });

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "doctor"]
    });

    assert.equal(result.status, 1, "doctor should fail when config.mobile is invalid");
    assert.match(
      String(result.stdout || ""),
      /config\.mobile is invalid: config\.mobile\.assetMode must be "bundled" or "dev_server"\./u
    );
  });
});

test("jskit mobile doctor reports missing devServerUrl for dev-server apps", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const sdkRoot = path.join(cwd, "android-sdk");

    await createMobileReadyApp(appRoot, {
      appId: "ai.jskit.exampleapp",
      apiBaseUrl: "https://api.example.test",
      androidPackageName: "ai.jskit.exampleapp",
      assetMode: "dev_server",
      devServerUrl: ""
    });
    await seedInstalledCapacitorShell(appRoot, {
      appId: "ai.jskit.exampleapp",
      appName: "Example Mobile",
      minSdk: 26
    });
    await prepareFakeAndroidSdk(sdkRoot);
    await writeFile(
      path.join(appRoot, "android", "app", "src", "main", "AndroidManifest.xml"),
      injectManagedDeepLinkBlock(
        DEFAULT_ANDROID_MANIFEST,
        buildManagedDeepLinkIntentFilterBlock({
          auth: {
            customScheme: "examplemobile"
          }
        })
      ),
      "utf8"
    );

    const result = runCli({
      cwd: appRoot,
      args: ["mobile", "doctor"],
      env: {
        ...process.env,
        ANDROID_HOME: sdkRoot
      }
    });

    assert.equal(result.status, 1, "doctor should fail when dev_server mode is missing devServerUrl");
    assert.match(String(result.stdout || ""), /config\.mobile\.devServerUrl must be set/u);
  });
});
