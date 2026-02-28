import path from "node:path";

function toPosix(value) {
  return value.replaceAll(path.sep, "/");
}

export { toPosix };
