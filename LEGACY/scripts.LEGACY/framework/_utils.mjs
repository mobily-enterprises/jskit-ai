import path from "node:path";

function toPosix(value) {
  return value.replaceAll(path.sep, "/");
}

function parseArgs(argv, { json = false } = {}) {
  const args = new Set(argv);
  return {
    strict: args.has("--strict"),
    json: json ? args.has("--json") : false
  };
}

export { toPosix, parseArgs };
