function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

export { toPosixPath };
