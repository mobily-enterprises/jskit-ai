import { createDefaultErrorPolicy } from "@jskit-ai/shell-web/client/error";

/**
 * App-owned error handling contract.
 * - policy(event, ctx): decide channel + presenter + message.
 * - defaultPresenterId: used when policy does not set presenterId.
 * - presenters: optional custom presenters registered at boot.
 */
export default Object.freeze({
  defaultPresenterId: "material.snackbar",
  policy: createDefaultErrorPolicy(),
  presenters: []
});
