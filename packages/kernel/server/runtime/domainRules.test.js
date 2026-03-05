import assert from "node:assert/strict";
import test from "node:test";

import { DomainValidationError } from "./errors.js";
import { runDomainRules } from "./domainRules.js";

test("runDomainRules accepts passing rules", async () => {
  await runDomainRules([
    {
      field: "email",
      check: () => null
    },
    {
      field: "plan",
      check: async () => true
    }
  ]);
});

test("runDomainRules throws DomainValidationError with fieldErrors", async () => {
  await assert.rejects(
    () =>
      runDomainRules([
        {
          field: "email",
          check: () => "Valid email is required."
        },
        {
          field: "plan",
          check: () => false,
          message: "Starter supports up to 2000 employees."
        }
      ]),
    (error) => {
      assert.equal(error instanceof DomainValidationError, true);
      assert.equal(error.status, 422);
      assert.equal(error.code, "domain_validation_failed");
      assert.deepEqual(error.details, {
        fieldErrors: {
          email: "Valid email is required.",
          plan: "Starter supports up to 2000 employees."
        }
      });
      return true;
    }
  );
});

test("runDomainRules supports custom error message and code", async () => {
  await assert.rejects(
    () =>
      runDomainRules(
        [
          {
            field: "company",
            check: () => "Company domain blocked."
          }
        ],
        {
          message: "Cannot process contact.",
          code: "contact_domain_invalid"
        }
      ),
    (error) => {
      assert.equal(error instanceof DomainValidationError, true);
      assert.equal(error.message, "Cannot process contact.");
      assert.equal(error.code, "contact_domain_invalid");
      assert.deepEqual(error.details, {
        fieldErrors: {
          company: "Company domain blocked."
        }
      });
      return true;
    }
  );
});

test("runDomainRules supports rule.when and object outcome", async () => {
  let called = 0;

  await assert.rejects(
    () =>
      runDomainRules([
        {
          field: "ignored",
          when: false,
          check: () => {
            called += 1;
            return "Should not run.";
          }
        },
        {
          field: "country",
          when: () => true,
          check: () => ({ ok: false, message: "Country is not in allowed market list." })
        }
      ]),
    (error) => {
      assert.equal(error instanceof DomainValidationError, true);
      assert.equal(called, 0);
      assert.deepEqual(error.details, {
        fieldErrors: {
          country: "Country is not in allowed market list."
        }
      });
      return true;
    }
  );
});

test("runDomainRules validates rule shape", async () => {
  await assert.rejects(
    () => runDomainRules("not-an-array"),
    /array of rules/
  );

  await assert.rejects(
    () =>
      runDomainRules([
        null
      ]),
    /must be an object/
  );

  await assert.rejects(
    () =>
      runDomainRules([
        {
          field: "email"
        }
      ]),
    /requires check\(\)/
  );
});
