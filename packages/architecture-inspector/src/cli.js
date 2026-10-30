#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const SCRIPT_FILE_PATTERN = /\.(?:[cm]?js|jsx|tsx?|vue)$/u;
// The inspection's old generation is bounded by the size of the declared
// scripts. It holds about 45 MiB per MiB of script; the bound leaves roughly a
// third more, so garbage is collected before memory grows far past what the
// inspection really holds.
const HEAP_BASE_MB = 192;
const HEAP_MB_PER_SCRIPT_MB = 56;

function pairs(entries, usage) {
  return entries.map((entry) => {
    const separator = entry.indexOf("=");
    if (separator < 1 || separator === entry.length - 1) {
      throw new Error(usage);
    }
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  });
}

function readOptions() {
  const { values } = parseArgs({ options: {
    "http-scope": { type: "string", default: "" },
    "api-base-path": { type: "string", default: "" },
    alias: { type: "string", multiple: true, default: [] },
    "api-prefix-alias": { type: "string", multiple: true, default: [] },
    calls: { type: "boolean", default: false }
  } });
  const aliases = {};
  for (const [name, directory] of pairs(values.alias, "Use --alias name=project-directory.")) {
    if (Object.hasOwn(aliases, name)) throw new Error("Duplicate architecture alias.");
    aliases[name] = directory;
  }
  const apiPrefixAliases = pairs(values["api-prefix-alias"], "Use --api-prefix-alias client-prefix=route-prefix.")
    .map(([client, route]) => ({ client, route }));
  if (new Set(apiPrefixAliases.map(({ client }) => client)).size !== apiPrefixAliases.length) {
    throw new Error("Duplicate API prefix alias.");
  }
  return {
    projectRoot: process.cwd(),
    aliases,
    httpScope: values["http-scope"],
    apiBasePath: values["api-base-path"],
    calls: values.calls,
    apiPrefixAliases
  };
}

async function readInput() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > MAX_INPUT_BYTES) throw new Error("Architecture inspection input exceeds 4 MiB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// File sizes only: the inspection itself validates every declared path.
async function heapLimitMb(projectRoot, input) {
  let bytes = 0;
  for (const file of Array.isArray(input?.files) ? input.files : []) {
    const absolute = typeof file?.path === "string" && SCRIPT_FILE_PATTERN.test(file.path) &&
      path.resolve(projectRoot, file.path);
    if (absolute && absolute.startsWith(`${projectRoot}${path.sep}`)) {
      bytes += (await lstat(absolute).catch(() => null))?.size || 0;
    }
  }
  return Math.ceil(HEAP_BASE_MB + HEAP_MB_PER_SCRIPT_MB * bytes / (1024 * 1024));
}

// The bounded inspection runs in a child Node process started with the old
// generation bound; a bound given by the caller is kept as it is.
async function launch(inputText) {
  const limit = await heapLimitMb(process.cwd(), JSON.parse(inputText));
  const child = spawn(process.execPath, [`--max-old-space-size=${limit}`, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: ["pipe", "inherit", "pipe"]
  });
  const errors = [];
  child.stderr.on("data", (chunk) => errors.push(chunk));
  child.stdin.end(inputText);
  const [code, signal] = await once(child, "close");
  const message = Buffer.concat(errors).toString("utf8");
  if (code !== 0) {
    throw new Error(signal || /heap out of memory/u.test(message)
      ? `Architecture inspection needs more than its ${limit} MB memory bound.`
      : message.trim() || "Architecture inspection failed.");
  }
}

async function inspect(inputText) {
  // Loaded here, so the launching process stays small.
  const { inspectVueArchitecture } = await import("./inspectVueArchitecture.js");
  const result = await inspectVueArchitecture({ ...readOptions(), input: JSON.parse(inputText) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  readOptions();
  const inputText = await readInput();
  await (process.execArgv.some((argument) => argument.startsWith("--max-old-space-size")) ? inspect(inputText) : launch(inputText));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
