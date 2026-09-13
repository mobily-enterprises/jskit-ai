import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

const logoDevImageSchema = createSchema({
  publishableKey: { type: "string", required: true, minLength: 4, maxLength: 512,
    validator: (value) => /^pk_[A-Za-z0-9_-]+$/.test(value) || "Use a Logo.dev publishable key starting with pk_." },
  domain: { type: "string", minLength: 3, maxLength: 253,
    validator: (value) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value) || "Enter an ASCII domain without a URL, port or path." },
  ticker: { type: "string", minLength: 1, maxLength: 32,
    validator: value => /^[a-z0-9][a-z0-9.-]*$/iu.test(value) || "Enter a stock ticker, optionally with its exchange suffix." },
  email: { type: "string", minLength: 3, maxLength: 320,
    validator: value => /^[^\s@]+@[^\s@]+$/u.test(value) || "Enter an email address for company-domain lookup." },
  size: { type: "integer", min: 1, max: 800, defaultTo: 128 },
  format: { type: "string", enum: ["png", "jpg", "webp", "svg"], defaultTo: "png" },
  theme: { type: "string", enum: ["auto", "light", "dark"], defaultTo: "auto" },
  greyscale: { type: "boolean", defaultTo: false },
  retina: { type: "boolean", defaultTo: false },
  fallback: { type: "string", enum: ["monogram", "404"], defaultTo: "monogram" }
});

function createLogoDevImageUrl(input) {
  const { publishableKey, domain, ticker, email, ...parameters } = validateSchemaPayload({ schema: logoDevImageSchema, mode: "replace" }, input, { statusCode: 422 });
  if ([domain, ticker, email].filter(value => value !== undefined).length !== 1) {
    const error = new Error("Choose exactly one domain, stock ticker or email address.");
    error.fieldErrors = { domain: "Choose exactly one lookup value." }; throw error;
  }
  // Resolve email locally: never transmit the address's local part to the CDN.
  if (email !== undefined) return createLogoDevImageUrl({ publishableKey, domain: email.split("@")[1], ...parameters });
  const identifier = ticker === undefined ? domain.toLowerCase() : `ticker/${ticker.toUpperCase()}`;
  const url = new URL(`https://img.logo.dev/${identifier}`);
  url.searchParams.set("token", publishableKey);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  return url.href;
}

export { createLogoDevImageUrl, logoDevImageSchema };
