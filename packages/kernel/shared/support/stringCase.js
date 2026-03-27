function toCamelCase(value = "") {
  return String(value || "")
    .replace(/[-_]+([a-zA-Z0-9])/g, (_, nextChar) => String(nextChar || "").toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase())
    .replace(/[-_]+$/g, "");
}

function toSnakeCase(value = "") {
  const source = String(value || "");
  if (!source) {
    return "";
  }

  const replaced = source
    .replace(/([A-Z0-9]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .replace(/__+/g, "_");

  return replaced
    .toLowerCase()
    .replace(/^_+/, "")
    .replace(/_+$/, "");
}

export { toCamelCase, toSnakeCase };
