import assert from "node:assert/strict";
import test from "node:test";
import { appendQueryString, splitPathQueryAndHash } from "./queryPath.js";

test("appendQueryString appends query to a path without existing search", () => {
  assert.equal(appendQueryString("/api/conversations", "cursor=2"), "/api/conversations?cursor=2");
});

test("appendQueryString appends query to a path with existing search", () => {
  assert.equal(appendQueryString("/api/conversations?status=open", "cursor=2"), "/api/conversations?status=open&cursor=2");
});

test("appendQueryString preserves hash fragments", () => {
  assert.equal(appendQueryString("/settings/account#profile", "returnTo=%2Fdashboard"), "/settings/account?returnTo=%2Fdashboard#profile");
});

test("appendQueryString ignores empty query strings", () => {
  assert.equal(appendQueryString("/api/conversations", ""), "/api/conversations");
});

test("splitPathQueryAndHash separates pathname, query string, and hash", () => {
  assert.deepEqual(splitPathQueryAndHash("/contacts?search=buddy#top"), {
    pathname: "/contacts",
    queryString: "search=buddy",
    hash: "#top"
  });

  assert.deepEqual(splitPathQueryAndHash("/contacts#top"), {
    pathname: "/contacts",
    queryString: "",
    hash: "#top"
  });

  assert.deepEqual(splitPathQueryAndHash("/contacts?search=buddy"), {
    pathname: "/contacts",
    queryString: "search=buddy",
    hash: ""
  });
});
