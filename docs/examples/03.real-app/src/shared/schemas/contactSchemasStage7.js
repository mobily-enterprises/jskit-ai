import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "./contactSchemas.js";
import {
  normalizeContactBody,
  normalizeContactQuery,
  normalizeContactParams
} from "../input/contactInputNormalization.js";

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
