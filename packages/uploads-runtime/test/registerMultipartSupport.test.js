import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerMultipartSupport } from "../src/server/multipart/registerMultipartSupport.js";

test("registerMultipartSupport parses an upload through real Fastify", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  await registerMultipartSupport(app);
  await registerMultipartSupport(app);
  app.post("/upload", async (request) => {
    const file = await request.file();
    return {
      fieldname: file.fieldname,
      filename: file.filename,
      mimetype: file.mimetype,
      contents: (await file.toBuffer()).toString("utf8")
    };
  });
  const response = await app.inject({
    method: "POST",
    url: "/upload",
    headers: { "content-type": "multipart/form-data; boundary=jskit-upload" },
    payload: [
      "--jskit-upload",
      'Content-Disposition: form-data; name="file"; filename="example.txt"',
      "Content-Type: text/plain",
      "",
      "Uploaded through JSKIT",
      "--jskit-upload--",
      ""
    ].join("\r\n")
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    fieldname: "file",
    filename: "example.txt",
    mimetype: "text/plain",
    contents: "Uploaded through JSKIT"
  });
});

test("registerMultipartSupport requires the explicit Fastify dependency", async () => {
  await assert.rejects(registerMultipartSupport(null), /requires Fastify/u);
});

test("registerMultipartSupport registers multipart parser only once", async () => {
  let registerCount = 0;
  const fastify = {
    register: async () => {
      registerCount += 1;
    },
    hasContentTypeParser: () => false
  };
  await registerMultipartSupport(fastify);
  await registerMultipartSupport(fastify);

  assert.equal(registerCount, 1);
});

test("registerMultipartSupport skips registration when parser already exists", async () => {
  let registerCount = 0;
  const fastify = {
    register: async () => {
      registerCount += 1;
    },
    hasContentTypeParser: (contentType) => String(contentType || "").trim().toLowerCase() === "multipart"
  };
  await registerMultipartSupport(fastify);

  assert.equal(registerCount, 0);
});
