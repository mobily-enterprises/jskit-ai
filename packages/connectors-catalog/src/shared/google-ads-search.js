import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

const id = { type: "string", required: true, validator: value => /^[0-9]{1,20}$/.test(value) || "Use a numeric Google ID." };
const text = (max) => ({ type: "string", required: true, minLength: 1, maxLength: max,
  validator: value => !/[\p{Cc}\p{Cf}]/u.test(value) || "Use plain text without control characters." });
const list = (item, min, max) => ({ type: "array", required: true, items: item,
  validator: values => values.length >= min && values.length <= max || `Provide ${min}–${max} values.` });
const micros = { type: "string", required: true, validator: value => /^[1-9][0-9]{0,11}$/.test(value) || "Use a positive integer string of at most 12 digits." };
const googleAdsSearchFields = {
  customerId: { ...id, validator: value => /^[0-9]{10}$/.test(value) || "Use a ten-digit customer ID." },
  nonPolitical: { type: "boolean", required: true, validator: value => value === true || "This Search recipe supports only non-political advertising." },
  name: text(100), currency: { type: "string", required: true, validator: value => /^[A-Z]{3}$/.test(value) || "Use the uppercase account currency code." },
  dailyBudgetMicros: micros, maxCpcMicros: micros,
  finalUrl: { ...text(2048), validator: value => {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash || "Use the public HTTPS landing page."; }
    catch { return "Use the public HTTPS landing page."; }
  } },
  conversionActionId: id,
  locationIds: list(id, 1, 10), languageId: id,
  keywords: list(text(80), 1, 20),
  headlines: list(text(30), 3, 15), descriptions: list(text(90), 2, 4)
};
const schema = createSchema(googleAdsSearchFields);
function validateGoogleAdsSearchPlan(input) {
  for (const key of ["customerId", "name", "currency", "dailyBudgetMicros", "maxCpcMicros", "finalUrl", "conversionActionId", "languageId"]) {
    if (typeof input?.[key] !== "string") throw new Error(`Search plan ${key} must be a string.`);
  }
  return validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
}
export { googleAdsSearchFields, validateGoogleAdsSearchPlan };
