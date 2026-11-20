/**
 * What the invitation page offers its visitor:
 * - "signIn": signed out, so create an account or sign in;
 * - "accept": signed in with the invited address (in any case), or one of the two is unknown;
 * - "joinAs": signed in with another address, in a workspace that lets any account holding the link join: it joins
 *   as the signed-in account once that is said;
 * - "invitedAddressOnly": signed in with another address, in a workspace whose invitations only the invited address
 *   accepts (a resolve that does not say counts as one).
 * @param {{ authenticated: boolean, authEmail: string, inviteEmail: string, requiresSameEmail?: boolean }} input
 * @returns {"signIn" | "accept" | "joinAs" | "invitedAddressOnly"}
 */
function inviteLandingChoice({ authenticated, authEmail, inviteEmail, requiresSameEmail }) {
  if (!authenticated) {
    return "signIn";
  }
  const signedInAs = String(authEmail || "").trim().toLowerCase();
  const invited = String(inviteEmail || "").trim().toLowerCase();
  if (!signedInAs || !invited || signedInAs === invited) {
    return "accept";
  }
  return requiresSameEmail === false ? "joinAs" : "invitedAddressOnly";
}

/**
 * The redeem request's body for accepting: joining as another address names it as `acceptAs`, which the server
 * checks against the signed-in account.
 * @param {{ choice: string, token: string, authEmail: string }} input
 */
function inviteRedeemPayload({ choice, token, authEmail }) {
  return {
    token,
    decision: "accept",
    ...(choice === "joinAs" ? { acceptAs: authEmail } : {})
  };
}

export { inviteLandingChoice, inviteRedeemPayload };
