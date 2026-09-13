import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { apolloIoDefinition } from "../shared/tokens.js";
import { jsonOperation, validatedOperation } from "./jsonOperation.js";

const text = { type: "string", minLength: 1, maxLength: 256 };
const id = { ...text, pattern: "^[A-Za-z0-9_-]+$" };
const page = { page: { type: "integer", min: 1, max: 500, defaultTo: 1 },
  per_page: { type: "integer", min: 1, max: 100, defaultTo: 25 } };
const strings = { type: "array", items: text, validator: value => value.length <= 100 || "Use at most 100 filter values." };
const domain = { ...text, pattern: "^(?!www\\.)(?:[A-Za-z0-9-]+\\.)+[A-Za-z]{2,}$" };
const charge = { type: "boolean", required: true, validator: value => value === true || "Explicitly authorize provider credit consumption." };
const record = key => result => typeof result?.[key]?.id === "string";
const collection = key => result => Array.isArray(result?.[key]);
const accountFields = { name: text, domain, owner_id: id, account_stage_id: id, phone: text, raw_address: text };
const contactFields = { first_name: text, last_name: text, organization_name: text, title: text,
  account_id: id, email: { ...text, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
  label_names: strings, contact_stage_id: id, present_raw_address: text, direct_phone: text,
  corporate_phone: text, mobile_phone: text };
const dealFields = { name: text, owner_id: id,
  amount: { ...text, pattern: "^[0-9]+(?:\\.[0-9]+)?$" }, opportunity_stage_id: id,
  closed_date: { ...text, pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    validator: value => { const date = new Date(value); return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value || "Enter a real YYYY-MM-DD date."; } } };

function query(method, endpoint, input) {
  const url = new URL(`https://api.apollo.io/api/v1/${endpoint}`);
  for (const [key, value] of Object.entries(input)) {
    if (key === "allowCreditConsumption") continue;
    if (Array.isArray(value)) for (const entry of value) url.searchParams.append(`${key}[]`, entry);
    else url.searchParams.set(key, String(value));
  }
  return { method, url: url.href };
}
function write(method, endpoint, fields, key, requiredNames = []) {
  return validatedOperation({ ...(method === "PATCH" ? { id: { ...id, required: true } } : {}), ...fields },
    ({ id: recordId, ...body }) => {
      if (!Object.keys(body).length || (requiredNames.length && !requiredNames.some(name => body[name]))) {
        throw new ConnectorError("connector_input_invalid", "Enter the record's required identifying fields or changes.", { statusCode: 422 });
      }
      return { method, url: `https://api.apollo.io/api/v1/${endpoint}${recordId ? `/${recordId}` : ""}`, body };
    }, record(key));
}
const apolloIoProvider = Object.freeze({
  ...apolloIoDefinition,
  apiOrigins: ["https://api.apollo.io"],
  apiKey: { headers: (key) => ({ "X-Api-Key": key }) },
  checkOperation: "accounts.search",
  operations: {
    "accounts.search": jsonOperation("https://api.apollo.io/api/v1/accounts/search", {
      ...page, q_organization_name: text
    }, collection("accounts"), "POST"),
    "people.search": validatedOperation({ ...page, q_person_name: text, q_keywords: text,
      person_titles: strings, person_locations: strings, organization_ids: strings,
      q_organization_domains_list: { ...strings, items: domain },
      include_similar_titles: { type: "boolean" }
    }, input => query("POST", "mixed_people/api_search", input), collection("people")),
    "organizations.search": validatedOperation({ ...page, q_organization_name: text,
      q_organization_domains_list: { ...strings, items: domain }, organization_locations: strings,
      allowCreditConsumption: charge
    }, input => query("POST", "mixed_companies/search", input), collection("organizations")),
    "people.enrich": validatedOperation({ id: { ...id, required: true }, allowCreditConsumption: charge,
      reveal_personal_emails: { type: "boolean", defaultTo: false }
    }, input => query("POST", "people/match", { ...input, reveal_phone_number: false,
      run_waterfall_email: false, run_waterfall_phone: false }),
      result => result?.person === null || record("person")(result)),
    "organizations.enrich": validatedOperation({ domain: { ...domain, required: true }, allowCreditConsumption: charge },
      input => query("GET", "organizations/enrich", input),
      result => result?.organization === null || record("organization")(result)),
    "contacts.search": jsonOperation("https://api.apollo.io/api/v1/contacts/search", {
      ...page, q_keywords: text, contact_stage_ids: strings, contact_label_ids: strings
    }, collection("contacts"), "POST"),
    "contacts.create": write("POST", "contacts", { ...contactFields,
      run_dedupe: { type: "boolean", required: true }
    }, "contact", ["first_name", "last_name", "email"]),
    "contacts.update": write("PATCH", "contacts", contactFields, "contact"),
    "accounts.create": write("POST", "accounts", accountFields, "account", ["name", "domain"]),
    "accounts.update": write("PATCH", "accounts", accountFields, "account"),
    "deals.list": validatedOperation({ ...page, sort_by_field: { ...text, enum: ["amount", "is_closed", "is_won"] } },
      input => query("GET", "opportunities/search", input), collection("opportunities")),
    "deals.create": write("POST", "opportunities", { ...dealFields, name: { ...text, required: true }, account_id: id }, "opportunity"),
    "deals.update": write("PATCH", "opportunities", dealFields, "opportunity"),
    "dealStages.list": jsonOperation("https://api.apollo.io/api/v1/opportunity_stages", {}, collection("opportunity_stages")),
    "users.list": validatedOperation(page, input => query("GET", "users/search", input), collection("users"))
  }
});
export { apolloIoProvider };
