import { normalizeObject } from "../../shared/support/normalize.js";
import { normalizeContributorEntry, registerTaggedSingleton, resolveTaggedEntries } from "./primitives.js";

const BOOTSTRAP_PAYLOAD_CONTRIBUTOR_TAG = Symbol.for("jskit.runtime.bootstrap.payloadContributors");

function registerBootstrapPayloadContributor(app, token, factory) {
  registerTaggedSingleton(app, token, factory, BOOTSTRAP_PAYLOAD_CONTRIBUTOR_TAG, {
    context: "registerBootstrapPayloadContributor"
  });
}

function resolveBootstrapPayloadContributors(scope) {
  return resolveTaggedEntries(scope, BOOTSTRAP_PAYLOAD_CONTRIBUTOR_TAG)
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
  BOOTSTRAP_PAYLOAD_CONTRIBUTOR_TAG,
  registerBootstrapPayloadContributor,
  resolveBootstrapPayloadContributors,
  resolveBootstrapPayload
};
