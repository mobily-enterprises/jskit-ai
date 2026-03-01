import assert from "node:assert/strict";
import test from "node:test";
import { buildPatch } from "../src/lib/settingsPatchBuilder.js";
import { toBoolean, toEnum, toPositiveInt, toTrimmedString } from "../src/lib/settingsValidation.js";

function createValidationError(status, message, options = {}) {
  const error = new Error(message);
  error.status = status;
  error.details = options.details;
  return error;
}

test("settings patch builder applies app field specs", () => {
  const fieldSpecs = {
    theme: {
      normalize(value) {
        return toEnum(toTrimmedString(value).toLowerCase(), ["system", "light", "dark"], {
          message: "Theme must be one of: system, light, dark."
        });
      }
    },
    avatarSize: {
      normalize(value) {
        return toPositiveInt(value, {
          min: 32,
          max: 128,
          message: "Avatar size must be an integer from 32 to 128."
        });
      }
    },
    securityAlerts: {
      normalize(value) {
        return toBoolean(value, {
          message: "Security alerts setting must be boolean."
        });
      }
    }
  };

  const parsed = buildPatch({
    input: {
      theme: "dark",
      avatarSize: "96",
      securityAlerts: true
    },
    fieldSpecs,
    createError: createValidationError
  });

  assert.deepEqual(parsed.patch, {
    theme: "dark",
    avatarSize: 96,
    securityAlerts: true
  });
  assert.deepEqual(parsed.fieldErrors, {});
});

test("settings patch builder reports field and empty-payload errors", () => {
  const fieldSpecs = {
    theme: {
      normalize(value) {
        return toEnum(toTrimmedString(value).toLowerCase(), ["system", "light", "dark"], {
          message: "Theme must be one of: system, light, dark."
        });
      }
    }
  };

  const empty = buildPatch({
    input: {},
    fieldSpecs,
    emptyField: "preferences",
    emptyMessage: "At least one preference field is required.",
    throwOnError: false
  });
  assert.equal(empty.fieldErrors.preferences, "At least one preference field is required.");

  assert.throws(
    () =>
      buildPatch({
        input: {
          theme: "invalid"
        },
        fieldSpecs,
        createError: createValidationError
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.fieldErrors.theme, "Theme must be one of: system, light, dark.");
      return true;
    }
  );
});
