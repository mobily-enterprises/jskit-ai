import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { catalogMessage, formatMessage, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";
import en from "../locales/en.json" with { type: "json" };
import { readSingleMultipartFile } from "../src/server/multipart/readSingleMultipartFile.js";
import {
  createUploadFieldError,
  readUploadBuffer,
  validateUploadMimeType
} from "../src/server/policy/uploadPolicy.js";

// Each upload field error carries a code whose catalog English, rendered with its
// params, is exactly the English the server sends.
function assertCodedFieldError(error, field, code) {
  const coded = error?.details?.fieldErrorCodes?.[field];
  assert.equal(coded?.code, code);
  assert.equal(formatMessage(catalogMessage(en, messageKeyForCode(coded.code)), coded.params), error.details.fieldErrors[field]);
  return true;
}

function multipartRequest(result) {
  return {
    async file() {
      if (result instanceof Error) {
        throw result;
      }
      return result;
    }
  };
}

test("upload policy field errors carry codes that render their English", async () => {
  assert.throws(
    () => validateUploadMimeType("application/pdf", { allowedMimeTypes: ["image/png", "image/jpeg"] }, { label: "Avatar" }),
    (error) => assertCodedFieldError(error, "file", "uploads.file.typeNotAllowed")
  );
  await assert.rejects(
    () => readUploadBuffer(Readable.from([Buffer.alloc(3 * 1024 * 1024)]), { maxBytes: 2 * 1024 * 1024, fieldName: "avatar", label: "Avatar" }),
    (error) => assertCodedFieldError(error, "avatar", "uploads.file.tooLarge")
  );
  await assert.rejects(
    () => readUploadBuffer(Readable.from([]), { fieldName: "avatar", label: "Avatar" }),
    (error) => assertCodedFieldError(error, "avatar", "uploads.file.empty")
  );
  assertCodedFieldError(createUploadFieldError("photo", ""), "photo", "uploads.file.invalid");
});

test("an upload field error with the caller's own message has no code", () => {
  const error = createUploadFieldError("photo", "Photo is blurry.");
  assert.equal(error.details.fieldErrors.photo, "Photo is blurry.");
  assert.equal(error.details.fieldErrorCodes, undefined);
});

test("multipart field errors carry codes that render their English", async () => {
  const options = { fieldName: "avatar", required: true, fieldErrorKey: "avatar", label: "Avatar", maxBytes: 5 * 1024 * 1024 };
  await assert.rejects(
    () => readSingleMultipartFile(multipartRequest(null), options),
    (error) => assertCodedFieldError(error, "avatar", "uploads.file.required")
  );
  await assert.rejects(
    () => readSingleMultipartFile(multipartRequest(Object.assign(new Error("too large"), { code: "FST_REQ_FILE_TOO_LARGE" })), options),
    (error) => assertCodedFieldError(error, "avatar", "uploads.file.tooLarge")
  );
  await assert.rejects(
    () => readSingleMultipartFile(multipartRequest(Object.assign(new Error("too many"), { code: "FST_FILES_LIMIT" })), options),
    (error) => assertCodedFieldError(error, "avatar", "uploads.file.tooMany")
  );
  await assert.rejects(
    () => readSingleMultipartFile(multipartRequest({ fieldname: "photo", file: Readable.from([]) }), options),
    (error) => assertCodedFieldError(error, "avatar", "uploads.file.fieldNotAllowed")
  );
});
