import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { logoUrlFromConfiguration } from "../patterns/public-image/example/logo-url.js";
import { createLogoDevImageUrl } from "../src/client/logo-dev.js";
import { logoDevDefinition } from "../src/shared/logo-dev.js";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";

test("Logo.dev builds an image URL with explicit public credentials and portable defaults", () => {
  const original = { publishableKey: "pk_fixture", domain: "EXAMPLE.COM" };
  assert.equal(createLogoDevImageUrl(original), "https://img.logo.dev/example.com?token=pk_fixture&size=128&format=png&theme=auto&greyscale=false&retina=false&fallback=monogram");
  assert.deepEqual(original, { publishableKey: "pk_fixture", domain: "EXAMPLE.COM" });
  const url = new URL(createLogoDevImageUrl({ ...original, size: 800, format: "webp", theme: "dark", greyscale: true, retina: true, fallback: "404" }));
  assert.equal(url.origin, "https://img.logo.dev");
  assert.deepEqual(Object.fromEntries(url.searchParams), { token: "pk_fixture", size: "800", format: "webp", theme: "dark", greyscale: "true", retina: "true", fallback: "404" });
  assert.equal(new URL(createLogoDevImageUrl({ ...original, domain: "xn--bcher-kva.example", format: "svg" })).pathname, "/xn--bcher-kva.example");
});

test("Logo.dev refuses private keys, path injection and invalid image options without echoing credentials", () => {
  const input = { publishableKey: "pk_fixture", domain: "example.com" };
  for (const publishableKey of ["sk_do-not-expose-this", "pk_", "pk_bad&token=other", "pk_bad/key", "env:LOGO_DEV_KEY"]) {
    assert.throws(() => createLogoDevImageUrl({ ...input, publishableKey }), (error) => {
      assert.ok(error.fieldErrors.publishableKey);
      assert.equal(error.message.includes(publishableKey), false);
      return true;
    });
  }
  for (const domain of ["https://example.com", "example.com/path", "example.com?token=other", "example.com:443", "example.com#x", "user@example.com", "../example.com", "example..com", "127.0.0.1", "-example.com", "example.com\n/", "a".repeat(64) + ".com"]) {
    assert.throws(() => createLogoDevImageUrl({ ...input, domain }), (error) => Boolean(error.fieldErrors.domain));
  }
  for (const changes of [{ size: 0 }, { size: 801 }, { size: 1.5 }, { format: "html" }, { theme: "custom" }, { fallback: "https://attacker.invalid" }, { retina: "maybe" }, { url: "https://attacker.invalid" }]) {
    assert.throws(() => createLogoDevImageUrl({ ...input, ...changes }), (error) => Boolean(error.fieldErrors));
  }
});

test("Logo.dev shares source configuration with the editor and never treats URL construction as a verified connection", async () => {
  assert.equal(logoDevDefinition.configurationOnly, true);
  const configuration = { schemaVersion: 1, registrations: {}, integrations: {
    logos: { provider: "logo-dev", displayName: "Brand logos", accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: "env:LOGO_DEV_PUBLISHABLE_KEY" } }
  }, extensions: { fromCli: true } };
  const parse = (value) => parseIntegrationConfiguration(JSON.stringify(value), { providers: [logoDevDefinition] });
  assert.deepEqual(parse(configuration), configuration);
  const invalid = structuredClone(configuration);
  invalid.integrations.logos.authentication.secretRef = "pk_should-not-be-in-source";
  assert.throws(() => parse(invalid), (error) => Boolean(error.fieldErrors["integrations.logos.authentication.secretRef"]));
  const service = createConnectionService({ configuration, providers: [logoDevDefinition],
    authorize: async (context) => context,
    resolveReference: async () => assert.fail("Image URL configuration must not resolve private credentials through server verification."),
    store: { withConnection: async () => assert.fail("No connection record should be written.") },
    fetchImpl: async () => assert.fail("No provider verification call exists for this public image flow.")
  });
  await assert.rejects(service.connectApiKey({ context: { applicationId: "app", subjectId: "team" }, integrationId: "logos" }), { code: "connector_mode_unavailable" });
});


test("the public-image source pattern resolves only the chosen reference and rejects other provider slots", async () => {
  const configurationText = await readFile(new URL("../patterns/public-image/example/integrations.json", import.meta.url), "utf8");
  const resolveReference = async (reference) => {
    assert.equal(reference, "env:LOGO_DEV_PUBLISHABLE_KEY");
    return "pk_from_binding";
  };
  const options = { configurationText, integrationId: "logos", resolveReference, image: { domain: "example.com", publishableKey: "pk_caller_override" } };
  assert.equal(new URL(await logoUrlFromConfiguration(options)).searchParams.get("token"), "pk_from_binding");
  await assert.rejects(logoUrlFromConfiguration({ ...options, integrationId: "missing" }), /Select a configured Logo.dev integration/);
  const other = JSON.parse(configurationText);
  other.integrations.logos.provider = "another-provider";
  await assert.rejects(logoUrlFromConfiguration({ ...options, configurationText: JSON.stringify(other), resolveReference: async () => assert.fail("Do not resolve another provider's credential.") }), /Select a configured Logo.dev integration/);
});

test("Logo.dev resolves stock tickers and email domains without disclosing the email local part", () => {
  const key = { publishableKey: "pk_fixture" };
  assert.equal(new URL(createLogoDevImageUrl({ ...key, ticker: "shel.l" })).pathname, "/ticker/SHEL.L");
  const url = createLogoDevImageUrl({ ...key, email: "private.person+tag@EXAMPLE.COM" });
  assert.equal(new URL(url).pathname, "/example.com"); assert.equal(url.includes("private"), false);
  for (const lookup of [{}, { domain: "example.com", ticker: "AAPL" }, { ticker: "../AAPL" }, { ticker: "AAPL?token=other" }, { email: "user@example.com/path" }, { email: "user@127.0.0.1" }, { email: "a@b@example.com" }])
    assert.throws(() => createLogoDevImageUrl({ ...key, ...lookup }));
});
