import path from "node:path";

function isIdentifier(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(value || ""));
}

function isInsidePackageRoot(packageRoot, candidatePath) {
  const relative = path.relative(path.resolve(packageRoot), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export { isIdentifier, isInsidePackageRoot };
