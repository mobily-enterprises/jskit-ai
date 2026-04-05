import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import {
  normalizeUploadPolicy,
  readUploadBuffer,
  validateUploadMimeType
} from "../src/server/policy/uploadPolicy.js";

test("normalizeUploadPolicy applies defaults and normalization", () => {
  const policy = normalizeUploadPolicy(
    {
      allowedMimeTypes: [" IMAGE/PNG ", "image/png", "image/jpeg"],
      maxUploadBytes: "123"
    },
    {
      allowedMimeTypes: ["image/webp"],
      maxUploadBytes: 50
    }
  );

  assert.deepEqual(policy.allowedMimeTypes, ["image/png", "image/jpeg"]);
  assert.equal(policy.maxUploadBytes, 123);
});

test("validateUploadMimeType rejects unsupported mime types", () => {
  assert.throws(
    () =>
      validateUploadMimeType("application/pdf", {
        allowedMimeTypes: ["image/png"]
      }),
    (error) => {
      assert.equal(error?.message, "Validation failed.");
      assert.equal(error?.details?.fieldErrors?.file, "File must be one of: image/png.");
      return true;
    }
  );
});

test("readUploadBuffer enforces max bytes and empty uploads", async () => {
  await assert.rejects(
    () =>
      readUploadBuffer(Readable.from([Buffer.from("abcdef")]), {
        maxBytes: 3,
        fieldName: "avatar",
        label: "Avatar"
      }),
    (error) => {
      assert.equal(error?.message, "Validation failed.");
      assert.equal(error?.details?.fieldErrors?.avatar, "Avatar file is too large. Maximum allowed size is 0MB.");
      return true;
    }
  );

  await assert.rejects(
    () =>
      readUploadBuffer(Readable.from([]), {
        fieldName: "avatar",
        label: "Avatar"
      }),
    (error) => {
      assert.equal(error?.message, "Validation failed.");
      assert.equal(error?.details?.fieldErrors?.avatar, "Avatar file is empty.");
      return true;
    }
  );
});
