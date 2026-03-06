import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
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

const contactIntakePostRouteContractStage7 = Object.freeze({
  ...contactIntakePostRouteContract,
  body: Object.freeze({
    ...contactIntakePostRouteContract.body,
    normalize: normalizeContactBody
  }),
  query: Object.freeze({
    ...contactIntakePostRouteContract.query,
    normalize: normalizeContactQuery
  })
});

const contactPreviewFollowupPostRouteContractStage7 = Object.freeze({
  ...contactPreviewFollowupPostRouteContract,
  body: Object.freeze({
    ...contactPreviewFollowupPostRouteContract.body,
    normalize: normalizeContactBody
  }),
  query: Object.freeze({
    ...contactPreviewFollowupPostRouteContract.query,
    normalize: normalizeContactQuery
  })
});

const contactByIdGetRouteContractStage7 = Object.freeze({
  ...contactByIdGetRouteContract,
  params: Object.freeze({
    ...contactByIdGetRouteContract.params,
    normalize: normalizeContactParams
  })
});

export {
  contactIntakePostRouteContractStage7,
  contactPreviewFollowupPostRouteContractStage7,
  contactByIdGetRouteContractStage7
};
