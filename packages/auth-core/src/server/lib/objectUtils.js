function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

export { asObject };
