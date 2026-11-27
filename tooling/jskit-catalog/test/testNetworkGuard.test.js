import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { planTestRuns } from "../scripts/test-command.mjs";
import {
  NETWORK_GUARD_PRELOAD,
  NETWORK_GUARD_VARIABLE,
  NETWORK_REFUSED_CODE,
  isAllowedTestHost,
  networkGuardEnvironment,
  withoutNetworkGuard
} from "../scripts/test-network-guard.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../scripts/jskit.mjs", import.meta.url));
const SERVERS = fileURLToPath(new URL("../scripts/browser-test-servers.mjs", import.meta.url));

async function withProject(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-network-guard-"));
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

/**
 * This process's environment without the guard this run may have given it, and without the variables that name a
 * database host, so a child is guarded only by what the code under test gives it.
 */
function unguardedEnvironment(more = {}) {
  const env = { ...process.env, NODE_OPTIONS: withoutNetworkGuard(process.env.NODE_OPTIONS), ...more };
  for (const name of ["DB_HOST", "DATABASE_URL", NETWORK_GUARD_VARIABLE, "NODE_TEST_CONTEXT"]) {
    if (!(name in more)) delete env[name];
  }
  return env;
}

// Each attempt connects with a lookup of its own, so a name never reaches DNS: the guard answers before any lookup, and
// a connection it lets through fails at the lookup with ENOTFOUND, or connects.
const ATTEMPTS = `
import net from "node:net";
let lookups = 0;
const lookup = (host, options, callback) => {
  lookups += 1;
  callback(Object.assign(new Error("getaddrinfo ENOTFOUND " + host), { code: "ENOTFOUND" }));
};
function attempt(options) {
  return new Promise((resolve) => {
    const socket = net.connect({ ...options, lookup });
    socket.setTimeout(2000, () => { socket.destroy(); resolve({ timedOut: true }); });
    socket.once("error", (error) => resolve({ code: error.code, message: error.message }));
    socket.once("connect", () => { socket.destroy(); resolve({ connected: true }); });
  });
}
`;

/** Runs `script` (an ES module) in a Node process given the guard's preload, and answers its JSON output and stderr. */
async function guarded(script, env = {}) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    "--import", NETWORK_GUARD_PRELOAD, "--input-type=module", "-e", `${ATTEMPTS}\n${script}`
  ], { env: unguardedEnvironment({ [NETWORK_GUARD_VARIABLE]: "jskit test", ...env }) });
  return { result: JSON.parse(stdout.trim().split("\n").at(-1)), stderr };
}

test("only loopback, localhost names and the database hosts the environment names are test hosts", () => {
  for (const host of ["127.0.0.1", "127.5.6.7", "::1", "[::1]", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1", "localhost",
    "LOCALHOST", "localhost.", "app.localhost", "0.0.0.0", "::"]) {
    assert.equal(isAllowedTestHost(host, {}), true, host);
  }
  for (const host of ["203.0.113.1", "10.0.0.5", "192.168.1.2", "128.0.0.1", "::ffff:10.0.0.1", "2001:db8::1",
    "example.com", "localhost.example.com", "api.openai.com"]) {
    assert.equal(isAllowedTestHost(host, {}), false, host);
  }
  const env = { DB_HOST: "DB.Internal", DATABASE_URL: "postgres://user:secret@pg.example.test:5432/app" };
  assert.equal(isAllowedTestHost("db.internal", env), true);
  assert.equal(isAllowedTestHost("pg.example.test", env), true);
  assert.equal(isAllowedTestHost("other.example.test", env), false);
  // A database host given as an address is the database's, whatever its range.
  assert.equal(isAllowedTestHost("10.0.0.5", { DB_HOST: "10.0.0.5" }), true);
  assert.equal(isAllowedTestHost("fd00::5", { DATABASE_URL: "mysql://app@[fd00::5]:3306/app" }), true);
  assert.equal(isAllowedTestHost("pg.example.test", { DATABASE_URL: "not a url" }), false);
});

test("a guarded process refuses a connection to an outside address or name before any lookup, naming it and the fix", async () => {
  const { result, stderr } = await guarded(`
const address = await attempt({ host: "203.0.113.1", port: 443 });
const name = await attempt({ host: "example.invalid", port: 443 });
const again = await attempt({ host: "example.invalid", port: 8443 });
const fetched = await fetch("https://example.invalid:9443/v1").then(() => ({ ok: true }),
  (error) => ({ code: error.cause?.code, message: error.cause?.message }));
console.log(JSON.stringify({ address, name, again, fetched, lookups }));
`);
  assert.equal(result.address.code, NETWORK_REFUSED_CODE);
  assert.equal(result.name.code, NETWORK_REFUSED_CODE);
  assert.equal(result.fetched.code, NETWORK_REFUSED_CODE);
  // Refused before the name was looked up.
  assert.equal(result.lookups, 0);
  assert.match(result.name.message, /^jskit test refused a connection to example\.invalid:443: tests never reach an outside service\./u);
  assert.match(result.name.message, /Stub it at the seam the app already uses/u);
  assert.match(result.name.message, /says why on its first line: `\/\/ jskit-test: network - <reason>`/u);
  assert.match(result.address.message, /203\.0\.113\.1:443/u);
  assert.match(result.fetched.message, /example\.invalid:9443/u);
  // Said on stderr too, once per host, so an app that swallows the error still shows it.
  assert.equal(stderr.match(/refused a connection to example\.invalid:/gu)?.length, 1, stderr);
  assert.equal(stderr.match(/refused a connection to 203\.0\.113\.1:443/gu)?.length, 1, stderr);
});

test("a guarded process reaches loopback, a unix socket and the database hosts its environment names", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jskit-network-guard-socket-"));
  try {
    const { result, stderr } = await guarded(`
const server = net.createServer((socket) => socket.end());
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const local = net.createServer((socket) => socket.end());
const socketPath = ${JSON.stringify(path.join(directory, "app.sock"))};
await new Promise((resolve) => local.listen(socketPath, resolve));
const results = {
  loopback: await attempt({ host: "127.0.0.1", port }),
  localhost: await attempt({ host: "localhost", port, family: 4 }),
  unix: await new Promise((resolve) => {
    const socket = net.connect(socketPath);
    socket.once("error", (error) => resolve({ code: error.code }));
    socket.once("connect", () => { socket.destroy(); resolve({ connected: true }); });
  }),
  dbHost: await attempt({ host: "db.example.invalid", port: 3306 }),
  databaseUrl: await attempt({ host: "pg.example.invalid", port: 5432 }),
  other: await attempt({ host: "api.example.invalid", port: 443 }),
  lookups
};
server.close();
local.close();
console.log(JSON.stringify(results));
`, { DB_HOST: "db.example.invalid", DATABASE_URL: "postgres://app:secret@pg.example.invalid:5432/app" });
    assert.deepEqual(result.loopback, { connected: true });
    assert.deepEqual(result.unix, { connected: true });
    // localhost goes through the lookup this test gave the connection, which finds nothing.
    assert.equal(result.localhost.code, "ENOTFOUND");
    // A database host is let through: its connection fails at the lookup, as it would without the guard.
    assert.equal(result.dbHost.code, "ENOTFOUND");
    assert.equal(result.databaseUrl.code, "ENOTFOUND");
    assert.equal(result.other.code, NETWORK_REFUSED_CODE);
    assert.equal(result.lookups, 3);
    assert.doesNotMatch(stderr, /db\.example\.invalid|pg\.example\.invalid/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the guard's environment adds its preload to NODE_OPTIONS once, and keeps the options already there", () => {
  const preload = `--import=${NETWORK_GUARD_PRELOAD}`;
  const env = networkGuardEnvironment({ NODE_OPTIONS: "--max-old-space-size=4096" }, "jskit test");
  assert.equal(env[NETWORK_GUARD_VARIABLE], "jskit test");
  assert.equal(env.NODE_OPTIONS, `--max-old-space-size=4096 ${preload}`);
  assert.equal(networkGuardEnvironment({ NODE_OPTIONS: env.NODE_OPTIONS }, "jskit test").NODE_OPTIONS, env.NODE_OPTIONS);
  assert.equal(networkGuardEnvironment({}, "jskit test").NODE_OPTIONS, preload);
  assert.equal(withoutNetworkGuard(env.NODE_OPTIONS), "--max-old-space-size=4096");
  assert.equal(withoutNetworkGuard(undefined), "");
});

const OUTSIDE = (host) => `import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
test("tries ${host}", async () => {
  const error = await new Promise((resolve) => {
    const socket = net.connect({ host: "${host}", port: 443, lookup: (name, options, callback) =>
      callback(Object.assign(new Error("getaddrinfo ENOTFOUND " + name), { code: "ENOTFOUND" })) });
    socket.once("error", resolve);
    socket.once("connect", () => resolve(null));
  });
  assert.equal(error?.code, process.argv.includes("--expect-lookup") ? "ENOTFOUND" : "${NETWORK_REFUSED_CODE}");
});
`;
const NETWORK_LINE = "// jskit-test: network - it checks the release mirror's answer";

test("a file that states why it must reach the network runs unguarded beside the others, and a bare marker fails", async () => {
  await withProject({
    "test/a.test.js": "",
    "test/mirror.test.js": `${NETWORK_LINE}\n`,
    "test/shared.test.js": "// jskit-test: alone - it rewrites the shared fixture directory\n"
  }, async (root) => {
    const plan = planTestRuns(["--test-reporter=dot"], { cwd: root, concurrency: 4 });
    assert.deepEqual(plan.network?.map(({ file, reason }) => [file, reason]),
      [["test/mirror.test.js", "it checks the release mirror's answer"]]);
    assert.deepEqual(plan.runs, [
      ["--test", "--test-concurrency=4", "--test-reporter=dot", "test/a.test.js"],
      ["--test", "--test-concurrency=4", "--test-reporter=dot", "test/mirror.test.js"],
      ["--test", "--test-concurrency=1", "--test-reporter=dot", "test/shared.test.js"]
    ]);
    assert.deepEqual(plan.guarded, [true, false, true]);
    // A file destination of the network run goes beside the guarded run's, never over it.
    assert.deepEqual(planTestRuns(["--test-reporter=junit", "--test-reporter-destination=out/junit.xml"],
      { cwd: root, concurrency: 4 }).runs[1].slice(2, 4), ["--test-reporter=junit", "--test-reporter-destination=out/junit.network.xml"]);
  });
  await withProject({ "test/a.test.js": "// jskit-test: network\n", "test/b.test.js": `import "node:test";\n${NETWORK_LINE}\n` }, async (root) => {
    assert.throws(() => planTestRuns([], { cwd: root }), (error) => {
      assert.match(error.message, /test\/a\.test\.js:1: write it as `\/\/ jskit-test: network - <why this file must reach an outside service>`/u);
      assert.match(error.message, /test\/b\.test\.js:2: a jskit-test marker belongs on the file's first line/u);
      return true;
    });
  });
});

test("jskit test guards every test file and what it starts, and leaves a file with a stated reason unguarded", async () => {
  await withProject({
    "test/outside.test.js": OUTSIDE("api.example.invalid"),
    "test/mirror.test.js": `${NETWORK_LINE}\n${OUTSIDE("mirror.example.invalid").replace("process.argv.includes(\"--expect-lookup\")", "true")}`,
    "test/child.test.js": `import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
test("a process the test starts is guarded too", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e",
    "import net from 'node:net'; const s = net.connect(443, 'child.example.invalid'); s.once('error', (e) => console.log(e.code));"]);
  assert.equal(String(output).trim(), "${NETWORK_REFUSED_CODE}");
});
`
  }, async (root) => {
    const env = unguardedEnvironment({ V64_TEST_CONCURRENCY: "2" });
    const run = await execFileAsync(process.execPath, [CLI_PATH, "test"], { cwd: root, env }).then(
      (result) => ({ code: 0, ...result }), (error) => error);
    const output = `${run.stdout}\n${run.stderr}`;
    assert.equal(run.code, 0, output);
    assert.match(output, /^jskit test: test\/mirror\.test\.js reaches the network: it checks the release mirror's answer$/mu);
    assert.match(output, /jskit test refused a connection to api\.example\.invalid:443/u);
    assert.doesNotMatch(output, /refused a connection to mirror\.example\.invalid/u);
  });
});

const GUARDED_APP_SERVER = `import http from "node:http";
import net from "node:net";
http.createServer((request, response) => {
  if (!request.url.startsWith("/outside")) return response.end("ok");
  const socket = net.connect({ host: "ai.example.invalid", port: 443, lookup: (name, options, callback) =>
    callback(Object.assign(new Error("getaddrinfo ENOTFOUND " + name), { code: "ENOTFOUND" })) });
  socket.once("error", (error) => response.end(JSON.stringify({ code: error.code, message: error.message })));
}).listen(Number(process.env.PORT), process.env.HOST);
`;
const BUILD = "import { mkdirSync, writeFileSync } from \"node:fs\";\nmkdirSync(\"dist\", { recursive: true });\nwriteFileSync(\"dist/index.html\", \"built\");\n";

test("the browser test servers are guarded: an app server's outside call is refused, naming the host and the fix", async () => {
  await withProject({
    "package.json": { name: "app", type: "module" },
    "server.mjs": GUARDED_APP_SERVER,
    "build.mjs": BUILD
  }, async (root) => {
    // A port the system picks, free again for the launcher's one server.
    const basePort = await new Promise((resolve) => {
      const server = net.createServer();
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        server.close(() => resolve(port));
      });
    });
    const settings = {
      workers: 1, host: "127.0.0.1", basePort, server: "node ./server.mjs", build: "node ./build.mjs", env: {},
      health: "/", workerEnvironments: path.join(root, "node_modules", ".cache", "jskit-browser-tests", `workers-${basePort}.json`)
    };
    const child = spawn(process.execPath, [SERVERS], {
      cwd: root,
      env: unguardedEnvironment({ JSKIT_BROWSER_TESTS: JSON.stringify(settings) }),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    });
    let errors = "";
    child.stderr.on("data", (chunk) => { errors += chunk; });
    try {
      await new Promise((resolve, reject) => {
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (/server\(s\) ready/u.test(output)) resolve();
        });
        child.once("exit", (code) => reject(new Error(`the launcher stopped (${code}): ${errors}`)));
      });
      const answer = await (await fetch(`http://127.0.0.1:${basePort}/outside`)).json();
      assert.equal(answer.code, NETWORK_REFUSED_CODE);
      assert.match(answer.message, /^jskit browser tests refused a connection to ai\.example\.invalid:443: tests never reach an outside service\./u);
      assert.match(answer.message, /browserTestConfig\(\)'s `env` or its `prepare` module/u);
    } finally {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already stopped.
      }
      if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
    }
  });
});

test("the preload is a module URL the guard's environment names", () => {
  assert.equal(NETWORK_GUARD_PRELOAD, pathToFileURL(fileURLToPath(NETWORK_GUARD_PRELOAD)).href);
});
