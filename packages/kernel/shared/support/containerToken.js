function isContainerToken(value) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return typeof value === "symbol" || typeof value === "function";
}

export { isContainerToken };
