function normalizeNestedEntries(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const entries = [];

  while (queue.length > 0) {
    const entry = queue.shift();
    if (Array.isArray(entry)) {
      queue.push(...entry);
      continue;
    }
    if (entry == null) {
      continue;
    }
    entries.push(entry);
  }

  return entries;
}

function assertTaggableApp(app, { context = "registry", ErrorType = Error } = {}) {
  if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
    throw new ErrorType(`${context} requires application singleton()/tag().`);
  }
}

function registerTaggedSingleton(app, token, factory, tag, { context = "registry", ErrorType = Error } = {}) {
  assertTaggableApp(app, { context, ErrorType });
  app.singleton(token, factory);
  app.tag(token, tag);
}

function resolveTaggedEntries(scope, tag) {
  if (!scope || typeof scope.resolveTag !== "function") {
    return [];
  }
  return normalizeNestedEntries(scope.resolveTag(tag));
}

function normalizeContributorEntry(entry) {
  if (typeof entry === "function") {
    return {
      contributorId: String(entry.name || "anonymous"),
      contribute: entry
    };
  }

  if (entry && typeof entry === "object" && typeof entry.contribute === "function") {
    return {
      ...entry,
      contributorId: String(entry.contributorId || "anonymous")
    };
  }

  return null;
}

export {
  normalizeNestedEntries,
  assertTaggableApp,
  registerTaggedSingleton,
  resolveTaggedEntries,
  normalizeContributorEntry
};
