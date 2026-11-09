import { AssertionError } from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import diagnosticsChannel from "node:diagnostics_channel";
import {
  countQueries,
  countRuntimeQueries,
  requireTestDatabase
} from "@jskit-ai/database-runtime/server/testDatabases";
import { MANY_ROW_CHANNEL } from "../server/resourceHandle.js";

const REPEATED_STATEMENTS_SHOWN = 5;
// The measurement open in the current async context: a many-row call reports for the one whose work makes it.
const openMeasurement = new AsyncLocalStorage();
// A quoted SQL string, written as a string so that source scanners that skip quoted text keep their place.
const SQL_STRING_LITERAL = new RegExp("'(?:[^']|'')*'", "gu");

/** A statement with its values taken out, so the same statement for another row reads the same. */
function normalizedStatement(sql) {
  return sql
    .replace(SQL_STRING_LITERAL, "?")
    .replace(/\$\d+/gu, "?")
    .replace(/\b\d+(?:\.\d+)?\b/gu, "?")
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/gu, "(?, ...)");
}

function mostRepeated(queries) {
  const counts = new Map();
  for (const query of queries) {
    const statement = normalizedStatement(query);
    counts.set(statement, (counts.get(statement) || 0) + 1);
  }
  return [...counts].sort((left, right) => right[1] - left[1]).slice(0, REPEATED_STATEMENTS_SHOWN);
}

function requireSizes(sizes) {
  const valid = Array.isArray(sizes) && sizes.length >= 2 &&
    sizes.every((size, index) => Number.isInteger(size) && size > 0 && (index === 0 || size > sizes[index - 1]));
  if (!valid) {
    throw new TypeError("expectFlatQueries sizes must be at least two growing whole numbers of rows, such as [10, 200].");
  }
}

/**
 * Counts the statements `work` sends, and the extra statements the many-row
 * calls among them report for their chunks after the first. Both come only
 * from `work` and the async work it starts, as countQueries() counts them, so
 * another test or a loop running meanwhile does not change the count.
 * @param {import("knex").Knex | import("knex").Knex.Transaction | null} knex
 * @param {() => unknown} work
 */
async function measure(knex, work) {
  const calls = [];
  const measurement = Symbol("measurement");
  const listen = (message) => {
    if (openMeasurement.getStore() === measurement) calls.push(message);
  };
  diagnosticsChannel.subscribe(MANY_ROW_CHANNEL, listen);
  try {
    const { count, queries } = await openMeasurement.run(measurement, () => knex ? countQueries(knex, work) : countRuntimeQueries(work));
    const chunkStatements = calls.reduce((total, { rows, chunkSize }) => total + Math.max(0, Math.ceil(rows / chunkSize) - 1), 0);
    return { count, chunkStatements, queries };
  } finally {
    diagnosticsChannel.unsubscribe(MANY_ROW_CHANNEL, listen);
  }
}

/**
 * Fails when a path's statements grow with its rows. For each size, smallest first, it seeds that many rows with
 * `seed(size)`, then runs `run(seeded, size)` and counts the statements it sends: through `knex` when given (its
 * transactions' included), else through the runtime of a server the test booted, as countRuntimeQueries() does. Only
 * the path's own statements count, from `run` and the async work it starts, so a test or a background loop sending
 * through the same Knex meanwhile changes nothing. The
 * extra statements of a many-row write's later chunks, which its handle reports, are allowed, so no number is
 * hand-picked. A flat path then sends as many statements at every size; a path that reads or writes row by row sends
 * more at each, and one that sends none at every size was counted on the wrong channel and fails too. On failure the message gives every count and the statements repeated most at the largest size. Its seed
 * keeps the sizes apart (a workspace or user of their own, or a fresh database).
 * @template S
 * @param {object} options
 * @param {number[]} [options.sizes] Growing row counts; 10 and 200 when absent.
 * @param {(size: number) => S | Promise<S>} options.seed
 * @param {(seeded: S, size: number) => unknown} options.run
 * @param {import("knex").Knex | import("knex").Knex.Transaction | null} [options.knex]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.environment The test's environment, such as `process.env`.
 * @returns {Promise<Array<{ size: number, count: number, chunkStatements: number }>>} The count at each size, and how
 *   many of its statements were later chunks of many-row writes.
 */
async function expectFlatQueries({ sizes = [10, 200], seed, run, knex = null, environment }) {
  requireTestDatabase(environment);
  requireSizes(sizes);
  // readable-check: allow method-probe - input validation: seed and run are the caller's own functions
  if (typeof seed !== "function" || typeof run !== "function") {
    throw new TypeError("expectFlatQueries requires seed(size) and run(seeded, size) functions.");
  }
  const measured = [];
  for (const size of sizes) {
    const seeded = await seed(size);
    measured.push({ size, ...await measure(knex, () => run(seeded, size)) });
  }
  const counts = measured.map(({ size, count, chunkStatements }) => ({ size, count, chunkStatements }));
  const [smallest] = measured;
  const largest = measured.at(-1);
  // A data path that sends nothing at every size was counted on the wrong channel, so it would pass unmeasured.
  if (measured.every(({ count }) => count === 0)) {
    throw new AssertionError({
      message: "The path sent no statement at any size, so nothing was measured: pass the test's knex when its features " +
        "run on it (startTestFeatures, createTestResourceRuntime), or the path never reached the database."
    });
  }
  const growing = ({ count, chunkStatements }) => count - chunkStatements > smallest.count - smallest.chunkStatements;
  if (measured.some(growing)) {
    const described = counts.map(({ size, count, chunkStatements }) =>
      `${count} at ${size} rows${chunkStatements > 0 ? ` (${chunkStatements} of them later chunks)` : ""}`);
    const repeated = mostRepeated(largest.queries).map(([statement, times]) => `  ${times} x ${statement}`);
    throw new AssertionError({
      message: [
        `The statements grow with the rows: ${described.join(", ")}.`,
        `Repeated most at ${largest.size} rows:`,
        ...repeated
      ].join("\n")
    });
  }
  return counts;
}

export { expectFlatQueries };
