import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { catalogMessage, formatMessage, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";
import { evaluateI18nCatalogContract } from "../../../tooling/test-support/i18nCatalogContract.mjs";
import { validatePaymentConfiguration } from "../src/shared/configuration.js";
import conformance from "../contracts/conformance.json" with { type: "json" };
import en from "../locales/en.json" with { type: "json" };

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "..", "..", "..");
const PACKAGE_DIR = path.join(REPO_ROOT, "packages", "payments-core");

function english(code, params) {
  const template = catalogMessage(en, messageKeyForCode(code));
  return template === undefined ? undefined : formatMessage(template, params);
}

test("payments-core English catalog matches its source", () => {
  const { problems } = evaluateI18nCatalogContract({
    repoRoot: REPO_ROOT,
    packageDir: PACKAGE_DIR
  });
  assert.deepEqual(problems, []);
});

test("every payment error's catalog English equals the English it throws", () => {
  const site = /(?:PaymentError|fail)\(\s*"(payment_[a-z_]+)",\s*"((?:[^"\\]|\\.)*)"(?:,\s*\d+)?(?:,\s*\{\s*messageCode:\s*"([^"]+)"(?:,\s*messageParams:\s*\{\s*provider:\s*"([^"]+)"\s*\})?\s*\})?/gu;
  const sources = fs.readdirSync(path.join(PACKAGE_DIR, "src", "server"))
    .map((file) => fs.readFileSync(path.join(PACKAGE_DIR, "src", "server", file), "utf8"));
  const sites = sources.join("\n").match(/(?:PaymentError|fail)\("payment_/gu).length;
  let checked = 0;
  for (const source of sources) {
    for (const [, code, message, messageCode, provider] of source.matchAll(site)) {
      const expected = JSON.parse(`"${message}"`);
      if (messageCode) {
        assert.equal(english(messageCode, provider ? { provider } : {}), expected, messageCode);
      } else {
        assert.equal(english(code), expected, code);
      }
      checked += 1;
    }
  }
  assert.equal(checked, sites);
});

test("configuration errors carry codes whose English matches each field error", () => {
  const coded = new Set();
  for (const item of conformance.configurationCases) {
    const documents = [item.document];
    if (item.id === "paddle-sandbox") {
      const document = structuredClone(item.document);
      delete document.extensions.payments.environments.sandbox.taxCategory;
      documents.push(document);
    }
    for (const document of documents) {
      let error = null;
      try {
        validatePaymentConfiguration(document);
      } catch (caught) {
        error = caught;
      }
      if (!error) continue;
      assert.equal(english(error.messageCode, error.messageParams), error.message, item.id);
      for (const entry of error.fieldErrors.filter(({ code }) => code)) {
        assert.equal(english(entry.code, entry.params), entry.message, entry.code);
        coded.add(entry.code);
      }
    }
  }
  assert.deepEqual([...coded].sort(), [
    "payments.configuration.paddleClientToken",
    "payments.configuration.paddleEnvironment",
    "payments.configuration.paddleTaxCategory",
    "payments.configuration.sharedConnectionRequired"
  ]);
});
