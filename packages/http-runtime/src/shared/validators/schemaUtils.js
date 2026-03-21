function asSchema(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a TypeBox schema object.`);
  }

  return value;
}

export { asSchema };
