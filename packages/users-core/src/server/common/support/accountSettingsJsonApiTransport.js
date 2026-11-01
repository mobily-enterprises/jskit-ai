import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";

/**
 * The account settings record's JSON:API id: the signed-in user's id.
 * @param {unknown} _record
 * @param {{ request: object }} context The route transport's context.
 */
function resolveAccountSettingsResourceId(_record, context) {
  const userId = resolveActorId(null, context.request);
  if (!userId) {
    throw new Error("JSON:API account settings response requires request.user.id.");
  }

  return userId;
}

export { resolveAccountSettingsResourceId };
