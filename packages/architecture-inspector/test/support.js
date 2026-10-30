import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectVueArchitecture } from "../src/inspectVueArchitecture.js";

const NO_PAGES = Object.freeze({ id: "app", adapter: "native", surface: "app", mode: "registered", registrations: [], pageRoots: [] });

function hashText(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

// A temporary project whose files are all declared inspection inputs, except
// `undeclared` files, which exist on disk only.
async function project(t, source, { discovery = NO_PAGES, packages, undeclared = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-calls-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [];
  for (const [file, text] of Object.entries({ ...source, ...undeclared })) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
    if (Object.hasOwn(source, file)) {
      files.push({ path: file, hash: hashText(text) });
    }
  }
  const input = {
    schema: "vibe64.architecture-inspection-input.v1",
    files,
    uiDiscovery: { discoveries: [discovery] },
    ...(packages ? { packages } : {})
  };
  return { root, input };
}

async function inspectCallsOf(t, source, options = {}) {
  const { discovery, packages, undeclared, ...inspection } = options;
  const { root, input } = await project(t, source, { discovery, packages, undeclared });
  const result = await inspectVueArchitecture({ projectRoot: root, input, calls: true, ...inspection });
  return { root, input, result };
}

function callsFrom(result, callee) {
  return result.calls.filter((call) => call.callee === callee);
}

export { NO_PAGES, callsFrom, hashText, inspectCallsOf, project };
