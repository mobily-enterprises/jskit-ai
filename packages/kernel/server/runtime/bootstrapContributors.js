const BOOTSTRAP_PAYLOAD_CONTRIBUTOR_TAG = Symbol.for("jskit.runtime.bootstrap.payloadContributors");

function normalizeContributorList(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const contributors = [];

  while (queue.length > 0) {
    const entry = queue.shift();
    if (Array.isArray(entry)) {
      queue.push(...entry);
      continue;
    }
    if (entry == null) {
      continue;
    }

    contributors.push(entry);
  }

  return contributors;
}

function normalizeBootstrapPayloadContributor(entry) {
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

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function registerBootstrapPayloadContributor(app, token, factory) {
  if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
    throw new Error("registerBootstrapPayloadContributor requires application singleton()/tag().");
  }

  app.singleton(token, factory);
  app.tag(token, BOOTSTRAP_PAYLOAD_CONTRIBUTOR_TAG);
}

function resolveBootstrapPayloadContributors(scope) {
  if (!scope || typeof scope.resolveTag !== "function") {
    return [];
  }

  return normalizeContributorList(scope.resolveTag(BOOTSTRAP_PAYLOAD_CONTRIBUTOR_TAG))
    .map((entry) => normalizeBootstrapPayloadContributor(entry))
    .filter(Boolean);
}

async function resolveBootstrapPayload(scope, context = {}) {
  const contributors = resolveBootstrapPayloadContributors(scope);
  let payload = {};

  for (const contributor of contributors) {
    const contribution = await contributor.contribute({
      ...normalizeObject(context),
      payload: Object.freeze({ ...payload })
    });
    payload = {
      ...payload,
      ...normalizeObject(contribution)
    };
  }

  return payload;
}

export {
  BOOTSTRAP_PAYLOAD_CONTRIBUTOR_TAG,
  registerBootstrapPayloadContributor,
  resolveBootstrapPayloadContributors,
  resolveBootstrapPayload
};
