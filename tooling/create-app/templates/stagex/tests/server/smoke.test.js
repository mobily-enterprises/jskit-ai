import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../../server.js";

test("contact routes handle intake, preview, conflicts, validation, and not-found", async () => {
  const app = await createServer();
  const validPayload = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines",
    employees: 40,
    plan: "growth",
    source: "web",
    country: "us",
    consentMarketing: true
  };

  const intake = await app.inject({
    method: "POST",
    url: "/api/v1/contacts/intake",
    payload: validPayload
  });
  assert.equal(intake.statusCode, 200);

  const validationFailure = await app.inject({
    method: "POST",
    url: "/api/v1/contacts/intake",
    payload: {
      ...validPayload,
      plan: "starter",
      employees: 500
    }
  });
  assert.equal(validationFailure.statusCode, 422);

  const duplicate = await app.inject({
    method: "POST",
    url: "/api/v1/contacts/intake",
    payload: validPayload
  });
  assert.equal(duplicate.statusCode, 409);

  const preview = await app.inject({
    method: "POST",
    url: "/api/v1/contacts/preview-followup",
    payload: {
      ...validPayload,
      email: "preview@example.com"
    }
  });
  assert.equal(preview.statusCode, 200);

  const missing = await app.inject({
    method: "GET",
    url: "/api/v1/contacts/does-not-exist"
  });
  assert.equal(missing.statusCode, 404);

  await app.close();
});
