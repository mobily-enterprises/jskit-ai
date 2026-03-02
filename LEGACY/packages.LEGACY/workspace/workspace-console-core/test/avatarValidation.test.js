import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedAvatarMimeType, normalizeAvatarSize, validateAvatarUpload } from "../src/lib/avatarValidation.js";

test("avatar validation normalizes size and mime types", () => {
  assert.equal(normalizeAvatarSize("64", { min: 32, max: 128, fallback: 64 }), 64);
  assert.equal(normalizeAvatarSize(16, { min: 32, max: 128, fallback: 64 }), 32);
  assert.equal(normalizeAvatarSize(200, { min: 32, max: 128, fallback: 64 }), 128);
  assert.equal(isAllowedAvatarMimeType("image/PNG", { allowedMimeTypes: ["image/png", "image/webp"] }), true);
  assert.equal(isAllowedAvatarMimeType("image/gif", { allowedMimeTypes: ["image/png", "image/webp"] }), false);
});

test("avatar validation checks upload payload", () => {
  const valid = validateAvatarUpload(
    {
      mimeType: "image/png",
      bytes: 1024
    },
    {
      allowedMimeTypes: ["image/png", "image/webp"],
      maxBytes: 5 * 1024
    }
  );
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.fieldErrors, {});

  const invalid = validateAvatarUpload(
    {
      mimeType: "image/gif",
      bytes: 9999
    },
    {
      allowedMimeTypes: ["image/png", "image/webp"],
      maxBytes: 1024
    }
  );
  assert.equal(invalid.valid, false);
  assert.ok(invalid.fieldErrors.avatar.includes("at most") || invalid.fieldErrors.avatar.includes("one of"));
});
