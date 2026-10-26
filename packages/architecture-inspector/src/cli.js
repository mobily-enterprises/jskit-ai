#!/usr/bin/env node
import { parseArgs } from "node:util";
import { inspectVueArchitecture } from "./inspectVueArchitecture.js";

try {
  const { values } = parseArgs({ options: {
    "http-scope": { type: "string", default: "" },
    "api-base-path": { type: "string", default: "" },
    alias: { type: "string", multiple: true, default: [] }
  } });
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 4 * 1024 * 1024) throw new Error("Architecture inspection input exceeds 4 MiB.");
    chunks.push(chunk);
  }
  const aliases = {};
  for (const entry of values.alias) {
    const separator = entry.indexOf("=");
    if (separator < 1 || separator === entry.length - 1) throw new Error("Use --alias name=project-directory.");
    const name = entry.slice(0, separator);
    if (Object.hasOwn(aliases, name)) throw new Error("Duplicate architecture alias.");
    aliases[name] = entry.slice(separator + 1);
  }
  const result = await inspectVueArchitecture({
    projectRoot: process.cwd(), input: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    aliases, httpScope: values["http-scope"], apiBasePath: values["api-base-path"]
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
