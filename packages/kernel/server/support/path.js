import path from "node:path";
import { normalizeText } from "../../shared/support/normalize.js";

function toPosixPath(value = "") {
  return String(value || "").replaceAll(path.sep, "/");
}

function resolveRequiredAppRoot(appRoot, { context = "operation" } = {}) {
  const normalizedAppRoot = normalizeText(appRoot);
  if (!normalizedAppRoot) {
    throw new Error(`${normalizeText(context) || "operation"} requires appRoot.`);
  }

  return path.resolve(normalizedAppRoot);
}

export {
  resolveRequiredAppRoot,
  toPosixPath
};
