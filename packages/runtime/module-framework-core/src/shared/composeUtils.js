function moduleSignature(modules) {
  return modules
    .map((module) => module.id)
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

function mergeDisabled(disabledById, entries) {
  for (const entry of entries || []) {
    if (!entry || !entry.id) {
      continue;
    }

    const existing = disabledById.get(entry.id);
    if (!existing) {
      disabledById.set(entry.id, { ...entry });
      continue;
    }

    const reasons = new Set([existing.reason, entry.reason].filter(Boolean));
    disabledById.set(entry.id, {
      ...existing,
      ...entry,
      reason: Array.from(reasons).join(", ")
    });
  }
}

function withModuleId(module, entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }

  if (Object.hasOwn(entry, "moduleId")) {
    return entry;
  }

  return {
    ...entry,
    moduleId: module.id
  };
}

export { moduleSignature, mergeDisabled, withModuleId };
