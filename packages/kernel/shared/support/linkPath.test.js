import assert from "node:assert/strict";
import test from "node:test";
import { isExternalLinkTarget, splitPathQueryHash, resolveLinkPath } from "./linkPath.js";

test("isExternalLinkTarget detects absolute external targets", () => {
  assert.equal(isExternalLinkTarget("https://example.com"), true);
  assert.equal(isExternalLinkTarget("mailto:test@example.com"), true);
  assert.equal(isExternalLinkTarget("//cdn.example.com/lib.js"), true);
  assert.equal(isExternalLinkTarget("/contacts"), false);
});

test("splitPathQueryHash separates pathname, search, and hash", () => {
  assert.deepEqual(splitPathQueryHash("/members?tab=all#list"), {
    pathname: "/members",
    search: "?tab=all",
    hash: "#list"
  });
});

test("resolveLinkPath composes basePath and relative path", () => {
  assert.equal(resolveLinkPath("/admin/w/acme", "/contacts"), "/admin/w/acme/contacts");
  assert.equal(resolveLinkPath("/admin/w/acme", "contacts/2"), "/admin/w/acme/contacts/2");
  assert.equal(resolveLinkPath("/admin/w/acme", "/"), "/admin/w/acme");
  assert.equal(resolveLinkPath("/", "/contacts"), "/contacts");
});

test("resolveLinkPath preserves query and hash", () => {
  assert.equal(resolveLinkPath("/admin/w/acme", "/contacts?sort=asc#top"), "/admin/w/acme/contacts?sort=asc#top");
  assert.equal(resolveLinkPath("/admin/w/acme", "?tab=profile"), "/admin/w/acme?tab=profile");
  assert.equal(resolveLinkPath("/admin/w/acme", "#details"), "/admin/w/acme#details");
});

test("resolveLinkPath keeps external targets unchanged", () => {
  assert.equal(resolveLinkPath("/admin/w/acme", "https://example.com/docs"), "https://example.com/docs");
});
