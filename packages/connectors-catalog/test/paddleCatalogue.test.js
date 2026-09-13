import test from "node:test";
import assert from "node:assert/strict";
import { createProductsWithPrices } from "../patterns/paddle-catalogue/example/create-products.js";

const item = () => ({ product: { name: "Example", tax_category: "saas" }, price: {
  description: "One-time purchase", unit_price: { amount: "1200", currency_code: "USD" }
} });

test("Paddle batch validates all items before writing and preserves a failed price's product", async () => {
  const calls = [];
  const runtime = { async invoke(request) {
    calls.push(request);
    if (request.operation === "prices.create") throw new Error("private-provider-error");
    return { data: { id: `pro_${"a".repeat(26)}` } };
  } };
  const options = { runtime, context: { subjectId: "admin", applicationId: "app" }, integrationId: "merchant" };
  await assert.rejects(createProductsWithPrices({ ...options, items: [item(), { ...item(), price: { description: "invalid" } }] }));
  assert.equal(calls.length, 0);
  const result = await createProductsWithPrices({ ...options, items: [item(), item()] });
  assert.equal(calls.length, 2);
  assert.deepEqual(result, { completed: [], failed: { index: 0, stage: "price", productId: `pro_${"a".repeat(26)}`, outcome: "requires-review" } });
  assert.equal(JSON.stringify(result).includes("private-provider-error"), false);
});

test("Paddle batch passes returned product IDs into prices and returns completed pairs", async () => {
  const calls = [];
  const runtime = { async invoke(request) {
    calls.push(request);
    return { data: { id: request.operation === "products.create" ? `pro_${"b".repeat(26)}` : `pri_${"c".repeat(26)}` } };
  } };
  const result = await createProductsWithPrices({ runtime, context: { subjectId: "admin" }, integrationId: "merchant", items: [item()] });
  assert.equal(calls[1].input.product_id, `pro_${"b".repeat(26)}`);
  assert.equal(calls[1].integrationId, "merchant");
  assert.deepEqual(result, { completed: [{ index: 0, productId: `pro_${"b".repeat(26)}`, priceId: `pri_${"c".repeat(26)}` }], failed: null });
});


test("Paddle batch keeps earlier success when a later product fails and starts no further items", async () => {
  let calls = 0;
  const runtime = { async invoke() {
    calls++;
    if (calls === 3) throw new Error("network outcome unknown");
    return { data: { id: calls === 1 ? `pro_${"d".repeat(26)}` : `pri_${"e".repeat(26)}` } };
  } };
  const result = await createProductsWithPrices({ runtime, context: {}, integrationId: "merchant", items: [item(), item(), item()] });
  assert.equal(calls, 3);
  assert.deepEqual(result, {
    completed: [{ index: 0, productId: `pro_${"d".repeat(26)}`, priceId: `pri_${"e".repeat(26)}` }],
    failed: { index: 1, stage: "product", outcome: "requires-review" }
  });
});
