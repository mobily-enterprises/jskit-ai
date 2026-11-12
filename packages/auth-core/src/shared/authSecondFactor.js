// The refusal of a request whose session has not proved its second factor as its route or action asks: 403, with
// `params.maxAgeSeconds` when it asks for a proof that recent.
const SECOND_FACTOR_REQUIRED = Object.freeze({
  code: "auth.secondFactor.required",
  message: "Confirm it's you with a code from your authenticator app."
});

/**
 * Whether an error is that refusal: the server's own, or the one a client's request received.
 * @param {{ status?: number, code?: string | null } | null | undefined} error
 */
function isSecondFactorRequired(error) {
  return error?.status === 403 && error?.code === SECOND_FACTOR_REQUIRED.code;
}

export { SECOND_FACTOR_REQUIRED, isSecondFactorRequired };
