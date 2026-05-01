import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeCrudNamespace(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requireCrudNamespace(namespace, { context = "requireCrudNamespace" } = {}) {
  const normalizedNamespace = normalizeCrudNamespace(namespace);
  if (!normalizedNamespace) {
    throw new TypeError(`${context} requires a non-empty namespace.`);
  }

  return normalizedNamespace;
}

function resolveCrudRecordChangedEvent(namespace = "") {
  const normalizedNamespace = requireCrudNamespace(namespace, {
    context: "resolveCrudRecordChangedEvent"
  });
  return `${normalizedNamespace.replace(/-/g, "_")}.record.changed`;
}

export {
  normalizeCrudNamespace,
  requireCrudNamespace,
  resolveCrudRecordChangedEvent
};
