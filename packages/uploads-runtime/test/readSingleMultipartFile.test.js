import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { readSingleMultipartFile } from "../src/server/multipart/readSingleMultipartFile.js";

test("readSingleMultipartFile normalizes file parts and forwards size limits", async () => {
  let receivedOptions = null;
  const request = {
    async file(options) {
      receivedOptions = options;
      return {
        fieldname: "avatar",
        filename: " face.png ",
        mimetype: " IMAGE/PNG ",
        encoding: " 7BIT ",
        file: Readable.from([Buffer.from("png")]),
        fields: {
          uploadDimension: {
            value: "256"
          }
        }
      };
    }
  };

  const filePart = await readSingleMultipartFile(request, {
    fieldName: "avatar",
    required: true,
    label: "Avatar",
    maxBytes: 5 * 1024 * 1024
  });

  assert.deepEqual(receivedOptions, {
    throwFileSizeLimit: true,
    limits: {
      files: 1,
      fileSize: 5 * 1024 * 1024
    }
  });
  assert.equal(filePart?.fieldName, "avatar");
  assert.equal(filePart?.fileName, "face.png");
  assert.equal(filePart?.mimeType, "image/png");
  assert.equal(filePart?.encoding, "7bit");
  assert.equal(filePart?.fields?.uploadDimension?.value, "256");
});

test("readSingleMultipartFile rejects missing required files", async () => {
  const request = {
    async file() {
      return null;
    }
  };

  await assert.rejects(
    () =>
      readSingleMultipartFile(request, {
        fieldName: "avatar",
        required: true,
        fieldErrorKey: "avatar",
        label: "Avatar"
      }),
    (error) => {
      assert.equal(error?.message, "Validation failed.");
      assert.equal(error?.details?.fieldErrors?.avatar, "Avatar file is required.");
      return true;
    }
  );
});

test("readSingleMultipartFile maps multipart size errors to validation errors", async () => {
  const request = {
    async file() {
      const error = new Error("request file too large");
      error.code = "FST_REQ_FILE_TOO_LARGE";
      throw error;
    }
  };

  await assert.rejects(
    () =>
      readSingleMultipartFile(request, {
        fieldName: "avatar",
        fieldErrorKey: "avatar",
        label: "Avatar",
        maxBytes: 5 * 1024 * 1024
      }),
    (error) => {
      assert.equal(error?.message, "Validation failed.");
      assert.equal(error?.details?.fieldErrors?.avatar, "Avatar file is too large. Maximum allowed size is 5MB.");
      return true;
    }
  );
});

test("readSingleMultipartFile rejects unexpected field names", async () => {
  let resumeCount = 0;
  const request = {
    async file() {
      return {
        fieldname: "document",
        filename: "face.png",
        mimetype: "image/png",
        encoding: "7bit",
        file: {
          resume() {
            resumeCount += 1;
          }
        },
        fields: {}
      };
    }
  };

  await assert.rejects(
    () =>
      readSingleMultipartFile(request, {
        fieldName: "avatar",
        fieldErrorKey: "avatar",
        label: "Avatar"
      }),
    (error) => {
      assert.equal(error?.message, "Validation failed.");
      assert.equal(error?.details?.fieldErrors?.avatar, 'Avatar field "document" is not allowed.');
      return true;
    }
  );

  assert.equal(resumeCount, 1);
});
