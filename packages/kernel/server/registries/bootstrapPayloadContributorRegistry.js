import { normalizeObject } from "../../shared/support/normalize.js";
import { normalizeContributorEntry, registerTaggedSingleton, resolveTaggedEntries } from "./primitives.js";

function registerBootstrapPayloadContributor(app, token, factory) {
  registerTaggedSingleton(app, token, factory, "jskit.runtime.bootstrap.payloadContributors", {
    context: "registerBootstrapPayloadContributor"
  });
}

function resolveBootstrapPayloadContributors(scope) {
  return resolveTaggedEntries(scope, "jskit.runtime.bootstrap.payloadContributors")
    .map((entry) => normalizeContributorEntry(entry))
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
  registerBootstrapPayloadContributor,
  resolveBootstrapPayloadContributors,
  resolveBootstrapPayload
};
