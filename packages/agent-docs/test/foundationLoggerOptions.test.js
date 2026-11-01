import assert from "node:assert/strict";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import Fastify from "fastify";

const PATTERNS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "patterns");

/**
 * The JSON lines a Fastify logger built from the logger options writes for one error, logged under `error` and `err`.
 * @param {object} loggerOptions
 */
async function loggedLines(loggerOptions) {
  const lines = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(String(chunk)));
      callback();
    }
  });
  const app = Fastify({ logger: { ...loggerOptions, stream } });
  const error = new Error("boom");
  app.log.error({ error }, "Under error.");
  app.log.error({ err: error }, "Under err.");
  await app.close();
  return lines.filter((line) => line.msg === "Under error." || line.msg === "Under err.");
}

for (const patternName of ["minimal-foundation", "shell-foundation"]) {
  test(`${patternName} logs an error's message and stack under error as under err`, async () => {
    const moduleUrl = pathToFileURL(path.join(PATTERNS_ROOT, patternName, "example", "server", "lib", "loggerOptions.js")).href;
    const { buildLoggerOptions } = await import(moduleUrl);

    const [underError, underErr] = await loggedLines(buildLoggerOptions());

    assert.equal(underError.error.message, "boom");
    assert.equal(underError.error.type, "Error");
    assert.match(underError.error.stack, /boom/u);
    assert.equal(underErr.err.message, "boom");
  });
}

test("without the error serializer Fastify's logger drops an error logged under error", async () => {
  const [underError] = await loggedLines({});

  assert.deepEqual(underError.error, {});
});
