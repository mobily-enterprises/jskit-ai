function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveActionUser(context, input) {
  const payload = normalizeObject(input);
  const request = context?.requestMeta?.request || null;
  return payload.user || request?.user || context?.actor || null;
}

export { resolveActionUser };
