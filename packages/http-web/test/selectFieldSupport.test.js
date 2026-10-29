import assert from "node:assert/strict";
import test from "node:test";
import { optionTitle, optionValue, selectionFieldState } from "../src/client/support/selectFieldSupport.js";

const services = [
  { value: 7, label: "Bath" },
  { value: 53, label: "Daycare - One Day" }
];
const field = { itemTitle: "label", itemValue: "value" };
const titles = (state) => state.items.map((item) => optionTitle(item, field.itemTitle));

test("an unresolved value is hidden while options load, never shown as its id", () => {
  const state = selectionFieldState({ ...field, modelValue: 53, items: [], loading: true }, new Map());

  assert.equal(state.modelValue, null);
  assert.deepEqual(state.items, []);
  assert.deepEqual(state.hiddenValues, [53]);
});

test("a listed value keeps its own option and title", () => {
  const state = selectionFieldState({ ...field, modelValue: 53, items: services, loading: true }, new Map());

  assert.equal(state.modelValue, 53);
  assert.equal(state.items, services);
  assert.deepEqual(state.hiddenValues, []);
});

test("an unmatched value reads Unavailable option once options settle and keeps its stored value", () => {
  const state = selectionFieldState({ ...field, modelValue: 99, items: services }, new Map());

  assert.equal(state.modelValue, 99);
  assert.deepEqual(titles(state), ["Bath", "Daycare - One Day", "Unavailable option"]);
  assert.equal(optionValue(state.items[2], field.itemTitle, field.itemValue), 99);
});

test("a remembered title survives a narrowed option list", () => {
  const seen = new Map();
  selectionFieldState({ ...field, modelValue: 53, items: services }, seen);
  const narrowed = selectionFieldState({ ...field, modelValue: 53, items: [services[0]], loading: true }, seen);

  assert.equal(narrowed.modelValue, 53);
  assert.deepEqual(titles(narrowed), ["Bath", "Daycare - One Day"]);
  assert.deepEqual(narrowed.hiddenValues, []);
});

test("multiple selections hide only their unresolved values while loading", () => {
  const state = selectionFieldState(
    { ...field, multiple: true, modelValue: [7, 99], items: [services[0]], loading: true },
    new Map()
  );

  assert.deepEqual(state.modelValue, [7]);
  assert.deepEqual(state.hiddenValues, [99]);
});

test("item-title and item-value follow Vuetify key paths, functions, and primitive items", () => {
  assert.equal(optionTitle({ service: { name: "Bath" } }, "service.name"), "Bath");
  assert.equal(optionTitle({ name: "Bath" }, (item) => item.name.toUpperCase()), "BATH");
  assert.equal(optionValue("Bath", "title", "value"), "Bath");
  assert.equal(optionValue({ title: "Bath" }, "title", "value"), "Bath");
});

test("returnObject models pass through unchanged", () => {
  const modelValue = { value: 99, label: "Grooming" };
  const state = selectionFieldState({ ...field, returnObject: true, modelValue, items: services, loading: true }, new Map());

  assert.deepEqual(state, { modelValue, items: services, hiddenValues: [] });
});
