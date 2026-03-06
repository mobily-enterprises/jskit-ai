import assert from "node:assert/strict";
import test from "node:test";

import { DomainValidationError } from "./errors.js";
import { assertNoDomainRuleFailures, collectDomainFieldErrors } from "./domainRules.js";

test("collectDomainFieldErrors collects string and object rule outcomes", () => {
  const fieldErrors = collectDomainFieldErrors([
    {
      field: "name",
      check: () => "name is required"
    },
    {
      field: "email",
      check: () => ({
        message: "invalid email"
      })
    },
    {
      field: "country",
      when: () => false,
      check: () => "country not allowed"
    }
  ]);

  assert.deepEqual(fieldErrors, {
    name: "name is required",
    email: "invalid email"
  });
});

test("assertNoDomainRuleFailures does not throw when rules pass", () => {
  assert.doesNotThrow(() =>
    assertNoDomainRuleFailures([
      {
        field: "name",
        check: () => null
      }
    ])
  );
});

test("assertNoDomainRuleFailures throws DomainValidationError with fieldErrors", () => {
  assert.throws(
    () =>
      assertNoDomainRuleFailures([
        {
          field: "plan",
          check: () => "starter plan supports up to 200 employees"
        }
      ]),
    (error) => {
      assert.equal(error instanceof DomainValidationError, true);
      assert.equal(error.code, "domain_validation_failed");
      assert.deepEqual(error.details, {
        fieldErrors: {
          plan: "starter plan supports up to 200 employees"
        }
      });
      return true;
    }
  );
});

test("assertNoDomainRuleFailures applies custom message and code", () => {
  assert.throws(
    () =>
      assertNoDomainRuleFailures(
        [
          {
            field: "email",
            check: () => "email must include @"
          }
        ],
        {
          message: "Contact domain validation failed.",
          code: "contact_domain_invalid"
        }
      ),
    (error) => {
      assert.equal(error instanceof DomainValidationError, true);
      assert.equal(error.message, "Contact domain validation failed.");
      assert.equal(error.code, "contact_domain_invalid");
      return true;
    }
  );
});
