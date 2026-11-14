import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseEnv, promisify } from "node:util";
import { parseArgs } from "../scripts/jskit.mjs";
import { formatEnvFile } from "../scripts/nix-app.mjs";
import {
  PACKAGE_NIX_MARKER,
  checkPackageNix,
  formatPackageNixReport,
  nixPackageName,
  packageNix,
  renderPackageNix
} from "../scripts/package-nix.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../scripts/jskit.mjs", import.meta.url));
const LAUNCHER_PATH = fileURLToPath(new URL("../scripts/nix-app.mjs", import.meta.url));
const MS_INTEGRITY = "sha512-ZX4LcjWFsXUW6VrBfGLiS6iTTbjZ/H1/OJRYPWb7FRhfuu9/1Lqm8IMv+yBC4u3+QDNNs5x99NkxzdqKKx7KsA==";

const lockOf = (packages) => ({ name: "shop", version: "1.2.3", lockfileVersion: 3, requires: true, packages });

const APP = Object.freeze({
  "package.json": {
    name: "@acme/Shop_app",
    version: "1.2.3",
    engines: { node: "26.x" },
    workspaces: ["packages/*"],
    scripts: { start: "node ./bin/server.js", build: "vite build", "db:migrate": "knex migrate:latest" },
    dependencies: { "@local/main": "0.1.0", ms: "2.1.3" }
  },
  "package-lock.json": lockOf({
    "": { name: "@acme/Shop_app", version: "1.2.3", workspaces: ["packages/*"] },
    "node_modules/@local/main": { resolved: "packages/main", link: true },
    "node_modules/ms": { version: "2.1.3", resolved: "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz", integrity: MS_INTEGRITY },
    "node_modules/fsevents": {
      version: "2.3.3",
      resolved: "https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz",
      integrity: "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
      optional: true,
      os: ["darwin"]
    },
    "node_modules/ms/node_modules/inner": { version: "1.0.0", inBundle: true },
    "packages/main": { name: "@local/main", version: "0.1.0" }
  }),
  "packages/main/package.json": { name: "@local/main", version: "0.1.0" }
});

async function withProject(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-package-nix-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const withLock = (packages) => ({ ...APP, "package-lock.json": lockOf({ ...APP["package-lock.json"].packages, ...packages }) });
const exists = (file) => stat(file).then(() => true, () => false);

// Nix's indented string ('' ... ''): the indentation every line shares is dropped, ''' is '', ''${ is ${ and ''\x
// escapes x. The embedded launcher must come out of it exactly as written.
function nixIndentedString(text) {
  const lines = text.split("\n");
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length));
  const body = lines.map((line) => line.slice(indent)).join("\n");
  let decoded = "";
  for (let index = 0; index < body.length; index += 1) {
    if (body.startsWith("'''", index)) {
      decoded += "''";
      index += 2;
    } else if (body.startsWith("''$", index)) {
      decoded += "$";
      index += 2;
    } else if (body.startsWith("''\\", index)) {
      decoded += { n: "\n", r: "\r", t: "\t" }[body[index + 3]] ?? body[index + 3];
      index += 3;
    } else {
      decoded += body[index];
    }
  }
  return decoded;
}

test("jskit package nix writes one package.nix, the same bytes for every app, embedding the launcher whole", async () => {
  await withProject(APP, async (root) => {
    const result = await packageNix({ projectRoot: root });
    assert.equal(result.ok, true, result.issues.join("\n"));
    assert.equal(result.changed, true);
    assert.equal(result.name, "shop-app");
    assert.equal(result.version, "1.2.3");
    assert.equal(result.node, "26");
    assert.equal(result.downloads, 2);
    assert.deepEqual(result.programs.map(({ name }) => name), ["shop-app", "shop-app-check", "shop-app-prepare", "shop-app-migrate"]);

    const written = await readFile(path.join(root, "package.nix"), "utf8");
    assert.equal(written, renderPackageNix());
    assert.ok(written.startsWith(PACKAGE_NIX_MARKER));
    assert.match(written, /^\{ pkgs \}:$/mu, "a function of the host's Nixpkgs");
    assert.doesNotMatch(written, /npmDepsHash|lib\.fakeHash|sha256-/u, "no hash to keep up to date by hand");

    const embedded = /launcher = pkgs\.writeText "jskit-app\.mjs" ''\n([\s\S]*?)\n {2}'';/u.exec(written);
    assert.ok(embedded, "package.nix embeds the launcher");
    assert.equal(`${nixIndentedString(embedded[1])}\n`, await readFile(LAUNCHER_PATH, "utf8"));

    const again = await packageNix({ projectRoot: root });
    assert.equal(again.ok, true);
    assert.equal(again.changed, false);
  });
  await withProject({ ...APP, "package.json": { ...APP["package.json"], name: "other", scripts: { start: "node x.js" } } }, async (root) => {
    const result = await packageNix({ projectRoot: root });
    assert.equal(result.ok, true, result.issues.join("\n"));
    assert.deepEqual(result.programs.map(({ name }) => name), ["other", "other-check", "other-prepare"]);
    assert.equal(await readFile(path.join(root, "package.nix"), "utf8"), renderPackageNix());
  });
});

test("the package's name is package.json's without its scope, as a program name", () => {
  assert.equal(nixPackageName("@acme/Shop_app"), "shop-app");
  assert.equal(nixPackageName("myapp"), "myapp");
  assert.equal(nixPackageName("accounts.hub"), "accounts-hub");
});

test("jskit package nix refuses what it cannot build offline and writes nothing", async (t) => {
  const cases = {
    "a git dependency": [withLock({
      "node_modules/tool": { version: "1.0.0", resolved: "git+ssh://git@github.com/acme/tool.git#0123456789abcdef0123456789abcdef01234567" }
    }), /node_modules\/tool comes from git/u],
    "a local tarball": [withLock({ "node_modules/tool": { version: "1.0.0", resolved: "file:vendor/tool-1.0.0.tgz" } }),
      /node_modules\/tool is a local file/u],
    "a download without its integrity hash": [withLock({
      "node_modules/tool": { version: "1.0.0", resolved: "https://registry.npmjs.org/tool/-/tool-1.0.0.tgz" }
    }), /node_modules\/tool has no integrity hash/u],
    "a dependency the lock never resolved": [withLock({ "node_modules/tool": { version: "1.0.0" } }),
      /node_modules\/tool has no resolved address/u],
    "a link outside the app": [withLock({ "node_modules/shared": { resolved: "../shared", link: true } }),
      /node_modules\/shared links to \.\.\/shared, outside the app/u],
    "a lock file npm 6 wrote": [{ ...APP, "package-lock.json": { name: "shop", lockfileVersion: 1, dependencies: {} } },
      /lockfileVersion 1/u],
    "no lock file": [{ "package.json": APP["package.json"] }, /no package-lock\.json/u],
    "no start script": [{ ...APP, "package.json": { ...APP["package.json"], scripts: { build: "vite build" } } },
      /no start script/u]
  };
  for (const [name, [files, issue]] of Object.entries(cases)) {
    await t.test(name, () => withProject(files, async (root) => {
      const result = await packageNix({ projectRoot: root });
      assert.equal(result.ok, false);
      assert.match(result.issues.join("\n"), issue);
      assert.equal(await exists(path.join(root, "package.nix")), false);
    }));
  }
});

test("jskit package nix never overwrites a package.nix it did not write", async () => {
  const own = "{ pkgs }: pkgs.hello\n";
  await withProject({ ...APP, "package.nix": own }, async (root) => {
    const result = await packageNix({ projectRoot: root });
    assert.equal(result.ok, false);
    assert.match(result.issues.join("\n"), /package\.nix is not one jskit package nix wrote/u);
    assert.equal(await readFile(path.join(root, "package.nix"), "utf8"), own);
  });
});

test("the CLI's package nix writes the file and says what the package runs; a refusal exits 1", async () => {
  assert.deepEqual(parseArgs(["package", "nix", "--root", "/tmp/app"]), { command: "package-nix", projectRoot: "/tmp/app" });
  assert.throws(() => parseArgs(["package"]), /Usage:/u);
  assert.throws(() => parseArgs(["package", "deb"]), /Unknown argument: deb/u);
  await withProject(APP, async (root) => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "package", "nix", "--root", root]);
    assert.match(stdout, /Wrote package\.nix: shop-app 1\.2\.3 on Node\.js 26, 2 npm downloads pinned by package-lock\.json/u);
    assert.match(stdout, /shop-app-migrate/u);
    const { stdout: second } = await execFileAsync(process.execPath, [CLI_PATH, "package", "nix", "--root", root]);
    assert.match(second, /package\.nix is already current/u);
  });
  await withProject({ "package.json": APP["package.json"] }, async (root) => {
    await assert.rejects(execFileAsync(process.execPath, [CLI_PATH, "package", "nix", "--root", root]),
      (error) => error.code === 1 && /no package-lock\.json/u.test(error.stderr));
  });
});

test("jskit check's package part judges only a package.nix that jskit package nix wrote", async () => {
  await withProject(APP, async (root) => {
    const none = await checkPackageNix({ projectRoot: root });
    assert.equal(none.ok, true);
    assert.equal(none.packaged, false);

    await packageNix({ projectRoot: root });
    const current = await checkPackageNix({ projectRoot: root });
    assert.equal(current.ok, true);
    assert.match(formatPackageNixReport(current), /package\.nix is current and package-lock\.json builds offline/u);

    await writeFile(path.join(root, "package.nix"), `${renderPackageNix()}# edited\n`);
    const stale = await checkPackageNix({ projectRoot: root });
    assert.deepEqual(stale.findings.map(({ rule }) => rule), ["package/nix-current"]);

    await writeFile(path.join(root, "package.nix"), renderPackageNix());
    await writeFile(path.join(root, "package-lock.json"), JSON.stringify(withLock({
      "node_modules/tool": { version: "1.0.0", resolved: "git+https://github.com/acme/tool.git#0123456789abcdef0123456789abcdef01234567" }
    })["package-lock.json"]));
    const offline = await checkPackageNix({ projectRoot: root });
    assert.equal(offline.ok, false);
    assert.deepEqual(offline.findings.map(({ rule }) => rule), ["package/nix-offline"]);
    assert.match(formatPackageNixReport(offline), /node_modules\/tool comes from git/u);
  });
  await withProject({ ...APP, "package.nix": "{ pkgs }: pkgs.hello\n" }, async (root) => {
    const own = await checkPackageNix({ projectRoot: root });
    assert.equal(own.ok, true);
    assert.equal(own.packaged, false);
  });
});

test("the launcher writes settings as an env file that Node reads back exactly", () => {
  const settings = {
    PLAIN: "plain",
    SPACED: "  with spaces  ",
    HASH: "has # hash",
    EQUALS: "a=b=c",
    DOLLARS: "$HOME ${X} $(whoami)",
    MULTILINE: "-----BEGIN KEY-----\nabc\n-----END KEY-----",
    APOSTROPHE: "it's",
    QUOTES: "say \"hi\"",
    BACKTICK: "back`tick",
    TWO_QUOTES: "both ' and \"",
    BACKSLASHES: "C:\\path\\n\\t",
    EMPTY: "",
    UNICODE: "café ☕",
    PORT: 3000,
    SECURE: true
  };
  const text = formatEnvFile(settings);
  assert.deepEqual({ ...parseEnv(text) }, Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, String(value)])));
  assert.equal(formatEnvFile({}), "");
  assert.throws(() => formatEnvFile({ "1BAD": "x" }), /1BAD is not an environment variable name/u);
  assert.throws(() => formatEnvFile({ "A-B": "x" }), /A-B is not an environment variable name/u);
  assert.throws(() => formatEnvFile({ NESTED: { a: 1 } }), /NESTED must be a string, a number or true or false/u);
  assert.throws(() => formatEnvFile({ NOTHING: null }), /NOTHING must be a string, a number or true or false/u);
  assert.throws(() => formatEnvFile({ ALL: "' ` \"" }), /ALL holds ', ` and " together/u);
  assert.throws(() => formatEnvFile(["x"]), /one JSON object/u);
});

async function launch(args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [LAUNCHER_PATH, ...args], options);
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

const REPORT = `import { appendFileSync } from "node:fs";
appendFileSync(process.env.OUT, JSON.stringify({ step: process.argv[2], cwd: process.cwd(), env: process.env }) + "\\n");
process.exitCode = Number(process.argv[3] || 0);
`;

async function withApp(scripts, run) {
  await withProject({ "package.json": { name: "app", version: "1.0.0", scripts }, "report.mjs": REPORT }, async (root) => {
    const out = path.join(root, "out.jsonl");
    await writeFile(path.join(root, "app.env"), `OUT='${out}'\nSECRET='s3cret value'\n`);
    const steps = async () => (await readFile(out, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    await run({ root, envFile: path.join(root, "app.env"), steps });
  });
}

test("serve runs the start script in place of the launcher, from the app, with the env file and NODE_ENV=production", async () => {
  await withApp({ start: "node report.mjs start 7" }, async ({ root, envFile, steps }) => {
    const result = await launch(["serve", "--app", root, "--shell", "/bin/sh", "--env", envFile]);
    assert.equal(result.code, 7, result.stderr);
    const [start] = await steps();
    assert.equal(start.step, "start");
    assert.equal(start.cwd, await realpath(root));
    assert.equal(start.env.SECRET, "s3cret value");
    assert.equal(start.env.NODE_ENV, "production");
    assert.equal(start.env.PATH.split(":")[0], path.join(root, "node_modules", ".bin"));
  });
  await withApp({ start: "node report.mjs start" }, async ({ root, envFile, steps }) => {
    await writeFile(envFile, `${await readFile(envFile, "utf8")}NODE_ENV=development\n`);
    assert.equal((await launch(["serve", "--app", root, "--shell", "/bin/sh", "--env", envFile])).code, 0);
    assert.equal((await steps())[0].env.NODE_ENV, "development");
  });
});

test("serve --migrate runs db:migrate first and starts nothing when it fails; migrate runs it alone", async () => {
  await withApp({ start: "node report.mjs start", "db:migrate": "node report.mjs migrate" }, async ({ root, envFile, steps }) => {
    assert.equal((await launch(["serve", "--app", root, "--shell", "/bin/sh", "--env", envFile, "--migrate"])).code, 0);
    assert.deepEqual((await steps()).map(({ step }) => step), ["migrate", "start"]);
    assert.equal((await launch(["migrate", "--app", root, "--shell", "/bin/sh", "--env", envFile])).code, 0);
    assert.deepEqual((await steps()).map(({ step }) => step), ["migrate", "start", "migrate"]);
  });
  await withApp({ start: "node report.mjs start", "db:migrate": "node report.mjs migrate 4" }, async ({ root, envFile, steps }) => {
    const result = await launch(["serve", "--app", root, "--shell", "/bin/sh", "--env", envFile, "--migrate"]);
    assert.equal(result.code, 4);
    assert.deepEqual((await steps()).map(({ step }) => step), ["migrate"]);
  });
  await withApp({ start: "node report.mjs start" }, async ({ root, envFile }) => {
    const result = await launch(["migrate", "--app", root, "--shell", "/bin/sh", "--env", envFile]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /app has no db:migrate script/u);
  });
});

// One service command for every JSKIT app: a host that starts each app with --migrate (it runs no release step) must
// start one without migrations too, rather than see it exit at every restart.
test("serve --migrate starts an app that has no db:migrate script, saying there is nothing to migrate", async () => {
  await withApp({ start: "node report.mjs start" }, async ({ root, envFile, steps }) => {
    const result = await launch(["serve", "--app", root, "--shell", "/bin/sh", "--env", envFile, "--migrate"]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual((await steps()).map(({ step }) => step), ["start"]);
    assert.match(result.stderr, /app has no db:migrate script, so there is nothing to migrate/u);
  });
});

test("prepare writes the settings as an env file that only its owner reads, and leaves nothing on a refusal", async () => {
  await withProject({ "settings.json": { DATABASE_URL: "postgres:///shop?host=/run/postgresql", PORT: 3000 } }, async (root) => {
    const envFile = path.join(root, "run", "app.env");
    const result = await launch(["prepare", "--settings", path.join(root, "settings.json"), "--env", envFile]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal((await stat(envFile)).mode & 0o777, 0o600);
    assert.deepEqual({ ...parseEnv(await readFile(envFile, "utf8")) }, { DATABASE_URL: "postgres:///shop?host=/run/postgresql", PORT: "3000" });

    await writeFile(path.join(root, "settings.json"), JSON.stringify({ "bad-key": "x" }));
    const refused = await launch(["prepare", "--settings", path.join(root, "settings.json"), "--env", envFile]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /bad-key is not an environment variable name/u);
    assert.deepEqual({ ...parseEnv(await readFile(envFile, "utf8")) }, { DATABASE_URL: "postgres:///shop?host=/run/postgresql", PORT: "3000" });
  });
});

// A host's data folders are its own (root's) until the start step hands them over: prepare makes the folders the
// settings name for the files a JSKIT app writes, for the user its service runs as.
test("prepare makes the folders the settings name for the app's files, owned by --user, and leaves relative ones alone", async () => {
  await withProject({}, async (root) => {
    const user = os.userInfo();
    const storage = path.join(root, "data", "storage");
    const auth = path.join(root, "data", "auth");
    await writeFile(path.join(root, "settings.json"), JSON.stringify({
      JSKIT_STORAGE_FS_BASE_PATH: storage, AUTH_LOCAL_STORE_DIR: auth, AUTH_OIDC_STORE_DIR: "relative/oidc", PORT: 3000
    }));
    const envFile = path.join(root, "run", "app.env");
    const result = await launch(["prepare", "--settings", path.join(root, "settings.json"), "--env", envFile, "--user", user.username]);
    assert.equal(result.code, 0, result.stderr);
    for (const folder of [storage, auth]) {
      const made = await stat(folder);
      assert.ok(made.isDirectory(), folder);
      assert.equal(made.uid, user.uid, folder);
      assert.equal(made.mode & 0o777, 0o700, folder);
    }
    assert.equal(await exists(path.join(root, "relative")), false);
    assert.equal(parseEnv(await readFile(envFile, "utf8")).AUTH_LOCAL_STORE_DIR, auth);
  });
});

async function withHealthServer(status, run) {
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/api/health" ? status : 404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: status === 200 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("check answers 0 once /api/health answers 200 on the env file's PORT, and 1 when it never does", async () => {
  await withProject({ "package.json": { name: "app", scripts: { start: "node x.js" } } }, async (root) => {
    const envFile = path.join(root, "app.env");
    await withHealthServer(200, async (port) => {
      await writeFile(envFile, `PORT=${port}\nHOST=0.0.0.0\n`);
      const result = await launch(["check", "--app", root, "--env", envFile, "--wait", "5"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /"ok":true/u);
    });
    await withHealthServer(503, async (port) => {
      await writeFile(envFile, `PORT=${port}\n`);
      const result = await launch(["check", "--app", root, "--env", envFile, "--wait", "1"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /\/api\/health answered 503/u);
    });
  });
});

test("npm-cache files each tarball under every hash its integrity names, where npm's cache looks for it", async () => {
  await withProject({ "ms.tgz": "a tarball" }, async (root) => {
    const tarball = path.join(root, "ms.tgz");
    const digest = (algorithm) => createHash(algorithm).update("a tarball").digest();
    const integrity = `sha512-${digest("sha512").toString("base64")} sha1-${digest("sha1").toString("base64")}`;
    await writeFile(path.join(root, "list"), `${integrity} ${tarball}\n${integrity} ${tarball}\n`);
    const result = await launch(["npm-cache", path.join(root, "list"), path.join(root, "cache")]);
    assert.equal(result.code, 0, result.stderr);
    for (const algorithm of ["sha512", "sha1"]) {
      const hex = digest(algorithm).toString("hex");
      const entry = path.join(root, "cache", "_cacache", "content-v2", algorithm, hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
      assert.equal(await readlink(entry), tarball);
    }
  });
});
