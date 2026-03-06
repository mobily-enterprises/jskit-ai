import {
  contactByIdRouteContract,
  contactIntakeRouteContract,
  contactPreviewFollowupRouteContract
} from "./contactSchemas.js";

function normalizeContactBody(rawBody) {
  return {
    name: String(rawBody?.name || "").trim(),
    email: String(rawBody?.email || "").trim().toLowerCase(),
    company: String(rawBody?.company || "").trim(),
    employees: Number(rawBody?.employees || 0),
    plan: String(rawBody?.plan || "").trim().toLowerCase(),
    source: String(rawBody?.source || "").trim().toLowerCase(),
    country: String(rawBody?.country || "").trim().toUpperCase(),
    consentMarketing: Boolean(rawBody?.consentMarketing)
  };
}

function normalizeContactQuery(rawQuery) {
  return {
    dryRun: rawQuery?.dryRun === true || rawQuery?.dryRun === "true"
  };
}

function normalizeContactParams(rawParams) {
  return {
    contactId: String(rawParams?.contactId || "").trim()
  };
}

const contactIntakeRouteContractStage7 = Object.freeze({
  ...contactIntakeRouteContract,
  body: Object.freeze({
    ...contactIntakeRouteContract.body,
    normalize: normalizeContactBody
  }),
  query: Object.freeze({
    ...contactIntakeRouteContract.query,
    normalize: normalizeContactQuery
  })
});

const contactPreviewFollowupRouteContractStage7 = Object.freeze({
  ...contactPreviewFollowupRouteContract,
  body: Object.freeze({
    ...contactPreviewFollowupRouteContract.body,
    normalize: normalizeContactBody
  }),
  query: Object.freeze({
    ...contactPreviewFollowupRouteContract.query,
    normalize: normalizeContactQuery
  })
});

const contactByIdRouteContractStage7 = Object.freeze({
  ...contactByIdRouteContract,
  params: Object.freeze({
    ...contactByIdRouteContract.params,
    normalize: normalizeContactParams
  })
});

export {
  contactIntakeRouteContractStage7,
  contactPreviewFollowupRouteContractStage7,
  contactByIdRouteContractStage7
};
