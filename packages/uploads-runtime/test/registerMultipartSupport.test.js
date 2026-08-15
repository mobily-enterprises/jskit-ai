import test from "node:test";
import assert from "node:assert/strict";
import { registerMultipartSupport } from "../src/server/multipart/registerMultipartSupport.js";

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
