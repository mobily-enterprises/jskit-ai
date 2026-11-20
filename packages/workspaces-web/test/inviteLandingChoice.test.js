import assert from "node:assert/strict";
import test from "node:test";
import { inviteLandingChoice, inviteRedeemPayload } from "../src/client/lib/inviteLandingChoice.js";

test("the invitation page offers sign-in, Accept, Join as or the invited address only, from who is signed in and the workspace's rule", () => {
  const signedIn = (authEmail, requiresSameEmail) =>
    inviteLandingChoice({ authenticated: true, authEmail, inviteEmail: "Invited@Example.com", requiresSameEmail });

  assert.equal(inviteLandingChoice({ authenticated: false, authEmail: "", inviteEmail: "invited@example.com" }), "signIn");
  assert.equal(signedIn("invited@example.com", true), "accept");
  assert.equal(signedIn(" INVITED@example.com ", false), "accept", "the same address in any case");
  assert.equal(signedIn("other@example.com", false), "joinAs");
  assert.equal(signedIn("other@example.com", true), "invitedAddressOnly");
  assert.equal(signedIn("other@example.com", undefined), "invitedAddressOnly", "a server that does not say is strict");
  assert.equal(signedIn("", false), "accept", "an unknown address is the server's to refuse");
});

test("joining as another address names it; accepting as the invited one sends what it always sent", () => {
  assert.deepEqual(inviteRedeemPayload({ choice: "joinAs", token: "t1", authEmail: "other@example.com" }),
    { token: "t1", decision: "accept", acceptAs: "other@example.com" });
  assert.deepEqual(inviteRedeemPayload({ choice: "accept", token: "t1", authEmail: "invited@example.com" }),
    { token: "t1", decision: "accept" });
});
