import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectVueArchitecture } from "../src/inspectVueArchitecture.js";
import { project } from "./support.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

async function runCli(root, input, args, nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, CLI, ...args], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.stdin.end(JSON.stringify(input));
  const [code] = await once(child, "close");
  return { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}

const SOURCE = {
  "packages/notes/src/server/routes.js": [
    "import { createActionRouteScope } from \"@jskit-ai/kernel/server/http\";",
    "export function registerRoutes(http) {",
    "  const routes = createActionRouteScope(http, { routeBase: \"/app/:slug\", relativePath: \"notes\" });",
    "  routes.actionRoute(\"GET\", \"/items\", { actionId: \"notes.list\" });",
    "}",
    ""
  ].join("\n"),
  "src/notes.js": "export function list() { return fetch(\"/api/notes/items\"); }\nexport function use() { return list(); }\n"
};

test("the CLI's --calls and --api-prefix-alias output equals the library's", async (t) => {
  const { root, input } = await project(t, SOURCE);
  const { code, stdout, stderr } = await runCli(root, input, ["--http-scope", "demo", "--api-prefix-alias", "/api/notes=/api/app/:slug/notes", "--calls"]);
  assert.equal(stderr, "");
  assert.equal(code, 0);
  const expected = await inspectVueArchitecture({
    projectRoot: root, input, httpScope: "demo", calls: true,
    apiPrefixAliases: [{ client: "/api/notes", route: "/api/app/:slug/notes" }]
  });
  assert.deepEqual(JSON.parse(stdout), expected);
  assert.equal(expected.operationUses[0].keyCertainty, "exact");
  assert.equal(expected.calls[0].callee, "list");
});

test("a caller's own memory bound runs the inspection in place", async (t) => {
  const { root, input } = await project(t, SOURCE);
  const bounded = await runCli(root, input, ["--calls"], ["--max-old-space-size=512"]);
  const launched = await runCli(root, input, ["--calls"]);
  assert.equal(bounded.code, 0);
  assert.equal(bounded.stdout, launched.stdout);
});

test("the CLI refuses malformed and duplicate prefix aliases", async (t) => {
  const { root, input } = await project(t, SOURCE);
  const malformed = await runCli(root, input, ["--api-prefix-alias", "/api/notes"]);
  assert.equal(malformed.code, 1);
  assert.equal(malformed.stderr, "Use --api-prefix-alias client-prefix=route-prefix.\n");
  const duplicate = await runCli(root, input, ["--api-prefix-alias", "/api/a=/x", "--api-prefix-alias", "/api/a=/y"]);
  assert.equal(duplicate.code, 1);
  assert.equal(duplicate.stderr, "Duplicate API prefix alias.\n");
  const trailing = await runCli(root, input, ["--api-prefix-alias", "/api/a/=/x"]);
  assert.equal(trailing.code, 1);
  assert.match(trailing.stderr, /without a trailing slash/u);
});
