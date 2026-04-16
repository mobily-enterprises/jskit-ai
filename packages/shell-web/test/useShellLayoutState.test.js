import assert from "node:assert/strict";
import test from "node:test";
import {
  SHELL_LAYOUT_DRAWER_DEFAULT_OPEN_STORAGE_KEY,
  readDrawerDefaultOpenPreference,
  writeDrawerDefaultOpenPreference
} from "../src/client/composables/shellLayoutDrawerPreference.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

test("readDrawerDefaultOpenPreference defaults to true when storage is missing or empty", () => {
  assert.equal(readDrawerDefaultOpenPreference({ storage: null }), true);
  assert.equal(readDrawerDefaultOpenPreference({ storage: createStorage() }), true);
});

test("readDrawerDefaultOpenPreference reads explicit stored booleans", () => {
  assert.equal(
    readDrawerDefaultOpenPreference({
      storage: createStorage({ [SHELL_LAYOUT_DRAWER_DEFAULT_OPEN_STORAGE_KEY]: "false" })
    }),
    false
  );

  assert.equal(
    readDrawerDefaultOpenPreference({
      storage: createStorage({ [SHELL_LAYOUT_DRAWER_DEFAULT_OPEN_STORAGE_KEY]: "true" })
    }),
    true
  );
});

test("writeDrawerDefaultOpenPreference persists normalized boolean strings", () => {
  const storage = createStorage();

  writeDrawerDefaultOpenPreference(false, { storage });
  assert.equal(storage.getItem(SHELL_LAYOUT_DRAWER_DEFAULT_OPEN_STORAGE_KEY), "false");

  writeDrawerDefaultOpenPreference(true, { storage });
  assert.equal(storage.getItem(SHELL_LAYOUT_DRAWER_DEFAULT_OPEN_STORAGE_KEY), "true");
});
