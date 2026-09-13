import { paddleProvider } from "../../../src/server/paddle.js";

// Application-owned composition: pass an application-mode connection runtime.
// An assistant host must approve the complete batch before calling this recipe.
async function createProductsWithPrices({ runtime, context, integrationId, items, signal }) {
  if (!Array.isArray(items) || !items.length || items.length > 100) {
    throw new TypeError("Supply between 1 and 100 products with prices.");
  }
  const batch = structuredClone(items);
  // Validate every item before the first write, using the adapter's own schema.
  for (const item of batch) {
    if (!item || typeof item !== "object" || Object.keys(item).some((key) => !["product", "price"].includes(key)) ||
        !item.product || !item.price || Object.hasOwn(item.price, "product_id")) {
      throw new TypeError("Each item needs product and price inputs; the new product supplies product_id.");
    }
    paddleProvider.operations["products.create"].request(item.product, { environment: "sandbox" });
    paddleProvider.operations["prices.create"].request({ ...item.price, product_id: `pro_${"a".repeat(26)}` }, { environment: "sandbox" });
  }
  const completed = [];
  for (const [index, item] of batch.entries()) {
    let productId;
    let stage = "product";
    try {
      const product = await runtime.invoke({ context, integrationId, signal, operation: "products.create", input: item.product });
      productId = product.data.id;
      stage = "price";
      const price = await runtime.invoke({ context, integrationId, signal, operation: "prices.create", input: { ...item.price, product_id: productId } });
      completed.push({ index, productId, priceId: price.data.id });
    } catch {
      // Do not replay the batch: a failed request may have reached Paddle.
      // Do not include raw provider errors or credential-bearing diagnostics.
      return { completed, failed: { index, stage, ...(productId ? { productId } : {}), outcome: "requires-review" } };
    }
  }
  return { completed, failed: null };
}

export { createProductsWithPrices };
