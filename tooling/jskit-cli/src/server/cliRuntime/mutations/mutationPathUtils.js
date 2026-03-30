function normalizeMutationRelativeFilePath(value = "") {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

export {
  normalizeMutationRelativeFilePath
};
