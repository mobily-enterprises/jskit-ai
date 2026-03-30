function toScopedPackageId(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("@")) {
    return raw;
  }
  return `@jskit-ai/${raw}`;
}

function resolvePackageIdInput(input, packageRegistry) {
  const raw = String(input || "").trim();
  if (!raw) {
    return "";
  }
  if (packageRegistry?.has(raw)) {
    return raw;
  }
  const scoped = toScopedPackageId(raw);
  if (scoped && packageRegistry?.has(scoped)) {
    return scoped;
  }
  return "";
}

function resolveInstalledPackageIdInput(input, installedPackages) {
  const raw = String(input || "").trim();
  if (!raw) {
    return "";
  }
  if (Object.prototype.hasOwnProperty.call(installedPackages || {}, raw)) {
    return raw;
  }
  const scoped = toScopedPackageId(raw);
  if (scoped && Object.prototype.hasOwnProperty.call(installedPackages || {}, scoped)) {
    return scoped;
  }
  return "";
}

export {
  toScopedPackageId,
  resolvePackageIdInput,
  resolveInstalledPackageIdInput
};
