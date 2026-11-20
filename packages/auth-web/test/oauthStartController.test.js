import assert from "node:assert/strict";
import test from "node:test";
import { AuthController } from "../src/server/controllers/AuthController.js";

test("a provider sign-in's start hands the auth service the invitation it starts from, only when there is one", async () => {
  const started = [];
  const controller = new AuthController({
    service: {
      async oauthStart(_request, input) {
        started.push(input);
        return { url: "https://provider.test/authorize" };
      },
      writeOAuthStartCookies() {}
    }
  });
  const reply = { location: "", redirect(url) { this.location = url; } };

  await controller.oauthStart({ params: { provider: "google" }, query: { returnTo: "/invite/tok", invitationToken: "inv-1" } }, reply);
  await controller.oauthStart({ params: { provider: "google" }, query: { returnTo: "/home" } }, reply);

  assert.deepEqual(started, [
    { provider: "google", returnTo: "/invite/tok", invitationToken: "inv-1" },
    { provider: "google", returnTo: "/home" }
  ]);
  assert.equal(reply.location, "https://provider.test/authorize");
});
