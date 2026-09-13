import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { xeroDefinition } from "../shared/xero.js";
import { jsonOperation } from "./jsonOperation.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const uuid = (value) => typeof value === "string" && uuidPattern.test(value);
const tenantId = { type: "string", required: true, validator: (value) => uuid(value) || "Choose an organisation ID returned by connections.list." };
const paging = {
  page: { type: "integer", min: 1, max: 1_000_000, defaultTo: 1 },
  pageSize: { type: "integer", min: 1, max: 200, defaultTo: 100 }
};
const connectionsUrl = "https://api.xero.com/connections";
const idempotencyField = { type: "string", required: true, minLength: 1, maxLength: 128,
  validator: value => /^[\x21-\x7e]+$/u.test(value) || "Use a stable printable request key." };
const dateField = { type: "string", noTrim: true, required: true,
  validator: value => /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value || "Use a valid YYYY-MM-DD date." };
const reportFields = {
  periods: { type: "integer", min: 1, max: 12 },
  timeframe: { type: "string", enum: ["MONTH", "QUARTER", "YEAR"] },
  standardLayout: { type: "boolean" }, paymentsOnly: { type: "boolean" }
};
const reportRow = row => row !== null && typeof row === "object" && !Array.isArray(row) && typeof row.RowType === "string" &&
  (row.Cells === undefined || Array.isArray(row.Cells) && row.Cells.every(cell => typeof cell?.Value === "string"));
const reportResult = value => Array.isArray(value?.Reports) && value.Reports.length === 1 && value.Reports.every(report =>
  typeof report?.ReportID === "string" && Array.isArray(report.Rows) && report.Rows.every(row => reportRow(row) &&
    (row.Rows === undefined || Array.isArray(row.Rows) && row.Rows.every(reportRow))));
const validConnections = (value) => Array.isArray(value) && value.every((entry) => uuid(entry?.id) && uuid(entry.tenantId) &&
  ["ORGANISATION", "PRACTICEMANAGER", "PRACTICE"].includes(entry.tenantType) && (entry.tenantName === null || typeof entry.tenantName === "string"));

function accountingRead(resource, fields, scopes, validateResult) {
  const schema = createSchema({ tenantId, ...fields });
  return {
    scopes, validateResult,
    request(input) {
      const { tenantId, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (values.fromDate && values.toDate && values.fromDate > values.toDate ||
          values.DateFrom && values.DateTo && values.DateFrom > values.DateTo) {
        throw new ConnectorError("connector_input_invalid", "The report start date must not follow its end date.", { statusCode: 422 });
      }
      const url = new URL(`https://api.xero.com/api.xro/2.0/${resource}`);
      for (const [name, value] of Object.entries(values)) url.searchParams.set(name, String(value));
      if (resource === "Contacts" || resource === "Invoices") url.searchParams.set("summaryOnly", "true");
      return { method: "GET", url: url.href, headers: { "Xero-tenant-id": tenantId.toLowerCase() } };
    }
  };
}

function accountingRecord(resource, idName, scopes, fields = {}) {
  const schema = createSchema({ tenantId, ...fields, id: { type: "string", required: true, validator: value => uuid(value) || "Use the record ID returned by Xero." } });
  return {
    scopes,
    request(input) {
      const { tenantId: tenant, id, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (values.DateFrom && values.DateTo && values.DateFrom > values.DateTo) {
        throw new ConnectorError("connector_input_invalid", "The budget start date must not follow its end date.", { statusCode: 422 });
      }
      const url = new URL(`https://api.xero.com/api.xro/2.0/${resource}/${id.toLowerCase()}`);
      for (const [name, value] of Object.entries(values)) url.searchParams.set(name, String(value));
      return { method: "GET", url: url.href,
        headers: { "Xero-tenant-id": tenant.toLowerCase() } };
    },
    validateResult: value => Array.isArray(value?.[resource]) && value[resource].length === 1 && uuid(value[resource][0]?.[idName])
  };
}

function contactWrite(update) {
  const schema = createSchema({
    tenantId,
    idempotencyKey: idempotencyField,
    ...(update ? { id: { type: "string", required: true, validator: value => uuid(value) || "Use the contact ID returned by Xero." } } : {}),
    Name: { type: "string", required: !update, minLength: 1, maxLength: 255 },
    FirstName: { type: "string", maxLength: 255 }, LastName: { type: "string", maxLength: 255 },
    EmailAddress: { type: "string", maxLength: 255 }, ContactNumber: { type: "string", maxLength: 50 }
  });
  return {
    scopes: ["accounting.contacts"],
    request(input) {
      const { tenantId: tenant, idempotencyKey, id, ...contact } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (Object.keys(contact).length === 0) throw new ConnectorError("connector_input_invalid", "Supply a contact field to change.", { statusCode: 422 });
      return { method: update ? "POST" : "PUT", url: `https://api.xero.com/api.xro/2.0/Contacts${update ? `/${id.toLowerCase()}` : ""}`,
        headers: { "Xero-tenant-id": tenant.toLowerCase(), "Idempotency-Key": idempotencyKey }, body: { Contacts: [contact] } };
    },
    validateResult: value => Array.isArray(value?.Contacts) && value.Contacts.length === 1 && uuid(value.Contacts[0]?.ContactID) &&
      value.Contacts[0].HasValidationErrors !== true && !value.Contacts[0].ValidationErrors?.length
  };
}

const paymentSchema = createSchema({
  tenantId, idempotencyKey: idempotencyField,
  invoiceId: { type: "string", required: true, validator: value => uuid(value) || "Choose an invoice ID." },
  accountId: { type: "string", required: true, validator: value => uuid(value) || "Choose an account ID." },
  Date: dateField,
  Amount: { type: "number", required: true, validator: value => Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER || "Use a positive finite payment amount." },
  CurrencyRate: { type: "number", validator: value => Number.isFinite(value) && value > 0 || "Use a positive finite exchange rate." },
  Reference: { type: "string", maxLength: 255 }
});
const finiteAmount = { type: "number", validator: value => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER || "Use a finite amount within the supported range." };
function invoiceWrite(update) {
  const schema = createSchema({
    tenantId, idempotencyKey: idempotencyField,
    ...(update ? { id: { type: "string", required: true, validator: value => uuid(value) || "Choose the invoice ID." } } : {}),
    Type: { type: "string", required: !update, enum: ["ACCREC", "ACCPAY"] },
    contactId: { type: "string", required: !update, validator: value => uuid(value) || "Choose a contact ID." },
    Date: { ...dateField, required: !update }, DueDate: { ...dateField, required: false },
    CurrencyCode: { type: "string", required: !update, validator: value => /^[A-Z]{3}$/u.test(value) || "Use the three-letter invoice currency code." },
    LineAmountTypes: { type: "string", required: !update, enum: ["Exclusive", "Inclusive", "NoTax"] },
    Status: { type: "string", enum: update ? ["DRAFT", "SUBMITTED", "AUTHORISED", "VOIDED", "DELETED"] : ["DRAFT", "SUBMITTED", "AUTHORISED"], ...(!update ? { defaultTo: "DRAFT" } : {}) },
    Reference: { type: "string", maxLength: 255 }, InvoiceNumber: { type: "string", maxLength: 255 },
    LineItems: { type: "array", required: !update, validator: values => values.length > 0 && values.length <= 100 || "Supply 1–100 invoice lines.",
      items: { type: "object", schema: createSchema({
        LineItemID: { type: "string", validator: value => uuid(value) || "Use the existing line item ID." },
        Description: { type: "string", required: true, minLength: 1, maxLength: 4000 },
        Quantity: { ...finiteAmount, required: true, min: 0.0001 },
        UnitAmount: { ...finiteAmount, required: true }, AccountCode: { type: "string", required: true, minLength: 1, maxLength: 50 },
        TaxType: { type: "string", maxLength: 50 }, DiscountRate: { type: "number", min: 0, max: 100 }
      }) }
    }
  });
  return {
    scopes: ["accounting.invoices"],
    request(input) {
      const { tenantId: tenant, idempotencyKey, id, contactId, ...invoice } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!contactId && !Object.keys(invoice).length) throw new ConnectorError("connector_input_invalid", "Supply an invoice field to change.", { statusCode: 422 });
      if (invoice.Type === "ACCPAY" && invoice.LineItems?.some(line => line.DiscountRate !== undefined)) {
        throw new ConnectorError("connector_input_invalid", "Discount rates apply only to sales invoices.", { statusCode: 422 });
      }
      if (contactId) invoice.Contact = { ContactID: contactId };
      return { method: update ? "POST" : "PUT", url: `https://api.xero.com/api.xro/2.0/Invoices${update ? `/${id.toLowerCase()}` : ""}?unitdp=4`,
        headers: { "Xero-tenant-id": tenant.toLowerCase(), "Idempotency-Key": idempotencyKey }, body: { Invoices: [invoice] } };
    },
    validateResult: value => Array.isArray(value?.Invoices) && value.Invoices.length === 1 && uuid(value.Invoices[0]?.InvoiceID) &&
      value.Invoices[0].HasErrors !== true && !value.Invoices[0].ValidationErrors?.length
  };
}

function attachmentOperation(action) {
  const writing = action === "upload" || action === "replace";
  const schema = createSchema({
    tenantId,
    resource: { type: "string", required: true, enum: ["Contacts", "Invoices", "BankTransactions", "ManualJournals"] },
    id: { type: "string", required: true, validator: value => uuid(value) || "Choose the parent record ID." },
    ...(action === "download" ? { attachmentId: { type: "string", required: true, validator: value => uuid(value) || "Choose an attachment ID from attachments.list." } } : {}),
    ...(writing ? {
      idempotencyKey: idempotencyField,
      filename: { type: "string", required: true, minLength: 1, maxLength: 255,
        // eslint-disable-next-line no-control-regex -- Reject literal control characters in provider input.
        validator: value => !/[\\/\x00-\x1f\x7f]/u.test(value) && ![".", ".."].includes(value) || "Use a filename without path separators or control characters." },
      contentBase64: { type: "string", required: true, minLength: 4, maxLength: 4194304, noTrim: true }
    } : {})
  });
  return {
    scopes: writing ? ["accounting.attachments"] : ["accounting.attachments.read", "accounting.attachments"],
    request(input) {
      const { tenantId: tenant, resource, id, attachmentId, filename, contentBase64, idempotencyKey } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      const suffix = attachmentId ? `/${attachmentId.toLowerCase()}` : filename ? `/${encodeURIComponent(filename)}` : "";
      const headers = { "Xero-tenant-id": tenant.toLowerCase() };
      let body;
      if (writing) {
        body = Buffer.from(contentBase64, "base64");
        if (!body.length || body.length > 3 * 1024 * 1024 || body.toString("base64") !== contentBase64) {
          throw new ConnectorError("connector_input_invalid", "Supply canonical base64 for a nonempty attachment of at most 3 MiB.", { statusCode: 422 });
        }
        headers["Content-Type"] = "application/octet-stream";
        headers["Idempotency-Key"] = idempotencyKey;
      }
      return { method: writing ? action === "upload" ? "PUT" : "POST" : "GET",
        url: `https://api.xero.com/api.xro/2.0/${resource}/${id.toLowerCase()}/Attachments${suffix}`, headers, ...(body ? { body } : {}) };
    },
    validateResult: action === "download"
      ? value => typeof value?.contentBase64 === "string" && Number.isInteger(value.size) && value.size > 0
      : value => Array.isArray(value?.Attachments) && (!writing || value.Attachments.length === 1) && value.Attachments.every(file =>
          uuid(file?.AttachmentID) && typeof file.FileName === "string" && Number.isInteger(file.ContentLength) && file.ContentLength >= 0)
  };
}

function bankTransactionWrite(update) {
  const schema = createSchema({
    tenantId, idempotencyKey: idempotencyField,
    ...(update ? { id: { type: "string", required: true, validator: value => uuid(value) || "Choose a bank transaction ID." } } : {}),
    Type: { type: "string", required: !update, enum: ["SPEND", "RECEIVE"] },
    contactId: { type: "string", required: !update, validator: value => uuid(value) || "Choose a contact ID." },
    bankAccountId: { type: "string", required: !update, validator: value => uuid(value) || "Choose a bank account ID." },
    Date: { ...dateField, required: !update }, Reference: { type: "string", maxLength: 255 },
    CurrencyRate: { type: "number", validator: value => Number.isFinite(value) && value > 0 || "Use a positive finite exchange rate." },
    LineAmountTypes: { type: "string", required: !update, enum: ["Exclusive", "Inclusive", "NoTax"] },
    ...(update ? { Status: { type: "string", enum: ["AUTHORISED", "DELETED"] } } : {}),
    LineItems: { type: "array", required: !update, validator: values => values.length > 0 && values.length <= 100 || "Supply 1–100 transaction lines.",
      items: { type: "object", schema: createSchema({
        LineItemID: { type: "string", validator: value => uuid(value) || "Use the existing line item ID." },
        Description: { type: "string", required: true, minLength: 1, maxLength: 4000 },
        Quantity: { ...finiteAmount, required: true, min: 0.0001 }, UnitAmount: { ...finiteAmount, required: true },
        AccountCode: { type: "string", required: true, minLength: 1, maxLength: 50 }, TaxType: { type: "string", maxLength: 50 }
      }) }
    }
  });
  return {
    scopes: ["accounting.banktransactions"],
    request(input) {
      const { tenantId: tenant, idempotencyKey, id, contactId, bankAccountId, ...transaction } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!contactId && !bankAccountId && !Object.keys(transaction).length) throw new ConnectorError("connector_input_invalid", "Supply a bank transaction field to change.", { statusCode: 422 });
      if (contactId) transaction.Contact = { ContactID: contactId };
      if (bankAccountId) transaction.BankAccount = { AccountID: bankAccountId };
      if (update) transaction.BankTransactionID = id.toLowerCase();
      return { method: update ? "POST" : "PUT", url: `https://api.xero.com/api.xro/2.0/BankTransactions${update ? `/${id.toLowerCase()}` : ""}?unitdp=4`,
        headers: { "Xero-tenant-id": tenant.toLowerCase(), "Idempotency-Key": idempotencyKey }, body: { BankTransactions: [transaction] } };
    },
    validateResult: value => Array.isArray(value?.BankTransactions) && value.BankTransactions.length === 1 && uuid(value.BankTransactions[0]?.BankTransactionID) &&
      !value.BankTransactions[0].ValidationErrors?.length
  };
}

function manualJournalWrite(update) {
  const schema = createSchema({
    tenantId, idempotencyKey: idempotencyField,
    ...(update ? { id: { type: "string", required: true, validator: value => uuid(value) || "Choose a manual journal ID." } } : {}),
    Narration: { type: "string", required: !update, minLength: 1, maxLength: 4000 },
    Date: { ...dateField, required: !update },
    LineAmountTypes: { type: "string", required: !update, enum: ["Exclusive", "Inclusive", "NoTax"] },
    Status: { type: "string", enum: update ? ["DRAFT", "POSTED", "DELETED", "VOIDED", "ARCHIVED"] : ["DRAFT", "POSTED"], ...(!update ? { defaultTo: "DRAFT" } : {}) },
    ShowOnCashBasisReports: { type: "boolean" },
    JournalLines: { type: "array", required: !update, validator: values => values.length >= 2 && values.length <= 100 || "Supply 2–100 journal lines.",
      items: { type: "object", schema: createSchema({
        LineAmount: { ...finiteAmount, required: true },
        AccountCode: { type: "string", required: true, minLength: 1, maxLength: 50 },
        Description: { type: "string", maxLength: 4000 }, TaxType: { type: "string", maxLength: 50 },
        Tracking: { type: "array", validator: values => values.length <= 2 || "Use at most two tracking categories.",
          items: { type: "object", schema: createSchema({
            Name: { type: "string", required: true, minLength: 1, maxLength: 100 },
            Option: { type: "string", required: true, minLength: 1, maxLength: 100 }
          }) }
        }
      }) }
    }
  });
  return {
    scopes: ["accounting.manualjournals"],
    request(input) {
      const { tenantId: tenant, idempotencyKey, id, ...journal } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (!Object.keys(journal).length) throw new ConnectorError("connector_input_invalid", "Supply a journal field to change.", { statusCode: 422 });
      if (update) journal.ManualJournalID = id.toLowerCase();
      return { method: update ? "POST" : "PUT", url: `https://api.xero.com/api.xro/2.0/ManualJournals${update ? `/${id.toLowerCase()}` : ""}`,
        headers: { "Xero-tenant-id": tenant.toLowerCase(), "Idempotency-Key": idempotencyKey }, body: { ManualJournals: [journal] } };
    },
    validateResult: value => Array.isArray(value?.ManualJournals) && value.ManualJournals.length === 1 && uuid(value.ManualJournals[0]?.ManualJournalID) &&
      !value.ManualJournals[0].ValidationErrors?.length
  };
}

const xeroProvider = Object.freeze({
  ...xeroDefinition,
  oauth: { issuer: "https://identity.xero.com", authorization_endpoint: "https://login.xero.com/identity/connect/authorize", token_endpoint: "https://identity.xero.com/connect/token" },
  apiOrigins: ["https://api.xero.com"], checkOperation: "connections.list",
  operations: {
    "attachments.list": attachmentOperation("list"),
    "attachments.download": attachmentOperation("download"),
    "attachments.upload": attachmentOperation("upload"),
    "attachments.replace": attachmentOperation("replace"),
    "connections.list": jsonOperation(connectionsUrl, {}, validConnections),
    "accounts.list": accountingRead("Accounts", {}, ["accounting.settings.read", "accounting.settings"],
      value => Array.isArray(value?.Accounts) && value.Accounts.every(account => uuid(account?.AccountID) && typeof account.Type === "string")),
    "currencies.list": accountingRead("Currencies", {}, ["accounting.settings.read", "accounting.settings"],
      value => Array.isArray(value?.Currencies) && value.Currencies.every(currency => /^[A-Z]{3}$/u.test(currency?.Code) && typeof currency.Description === "string")),
    "taxRates.list": accountingRead("TaxRates", {}, ["accounting.settings.read", "accounting.settings"],
      value => Array.isArray(value?.TaxRates) && value.TaxRates.every(rate => typeof rate?.TaxType === "string" && typeof rate.Name === "string")),
    "trackingCategories.list": accountingRead("TrackingCategories", { includeArchived: { type: "boolean", defaultTo: false } },
      ["accounting.settings.read", "accounting.settings"],
      value => Array.isArray(value?.TrackingCategories) && value.TrackingCategories.every(category => uuid(category?.TrackingCategoryID) && typeof category.Name === "string")),
    "reports.agedReceivables": accountingRead("Reports/AgedReceivablesByContact", {
      contactId: { type: "string", required: true, validator: value => uuid(value) || "Choose a contact ID." },
      date: dateField, fromDate: { ...dateField, required: false }, toDate: { ...dateField, required: false }
    }, ["accounting.reports.aged.read"], reportResult),
    "reports.agedPayables": accountingRead("Reports/AgedPayablesByContact", {
      contactId: { type: "string", required: true, validator: value => uuid(value) || "Choose a contact ID." },
      date: dateField, fromDate: { ...dateField, required: false }, toDate: { ...dateField, required: false }
    }, ["accounting.reports.aged.read"], reportResult),
    "reports.executiveSummary": accountingRead("Reports/ExecutiveSummary", { date: dateField },
      ["accounting.reports.executivesummary.read"], reportResult),
    "reports.bankSummary": accountingRead("Reports/BankSummary", { fromDate: dateField, toDate: dateField },
      ["accounting.reports.banksummary.read"], reportResult),
    "reports.trialBalance": accountingRead("Reports/TrialBalance", { date: dateField, paymentsOnly: { type: "boolean" } },
      ["accounting.reports.trialbalance.read"], reportResult),
    "budgets.list": accountingRead("Budgets", {
      DateFrom: { ...dateField, required: false }, DateTo: { ...dateField, required: false }
    }, ["accounting.budgets.read"],
      value => Array.isArray(value?.Budgets) && value.Budgets.every(budget => uuid(budget?.BudgetID) && ["OVERALL", "TRACKING"].includes(budget.Type))),
    "budgets.get": accountingRecord("Budgets", "BudgetID", ["accounting.budgets.read"], {
      DateFrom: { ...dateField, required: false }, DateTo: { ...dateField, required: false }
    }),
    "reports.budgetSummary": accountingRead("Reports/BudgetSummary", {
      date: dateField, periods: { type: "integer", min: 1, max: 12 },
      timeframe: { type: "integer", validator: value => [1, 3, 12].includes(value) || "Use 1 (month), 3 (quarter) or 12 (year)." }
    }, ["accounting.reports.budgetsummary.read"], reportResult),
    "bankTransactions.create": bankTransactionWrite(false),
    "bankTransactions.update": bankTransactionWrite(true),
    "bankTransactions.list": accountingRead("BankTransactions", { page: paging.page },
      ["accounting.banktransactions.read", "accounting.banktransactions"],
      value => Array.isArray(value?.BankTransactions) && value.BankTransactions.length <= 100 && value.BankTransactions.every(record => uuid(record?.BankTransactionID))),
    "bankTransactions.get": accountingRecord("BankTransactions", "BankTransactionID", ["accounting.banktransactions.read", "accounting.banktransactions"]),
    "manualJournals.create": manualJournalWrite(false),
    "manualJournals.update": manualJournalWrite(true),
    "manualJournals.list": accountingRead("ManualJournals", { page: paging.page },
      ["accounting.manualjournals.read", "accounting.manualjournals"],
      value => Array.isArray(value?.ManualJournals) && value.ManualJournals.length <= 100 && value.ManualJournals.every(record => uuid(record?.ManualJournalID))),
    "manualJournals.get": accountingRecord("ManualJournals", "ManualJournalID", ["accounting.manualjournals.read", "accounting.manualjournals"]),
    "payments.create": {
      scopes: ["accounting.payments"],
      request(input) {
        const { tenantId: tenant, idempotencyKey, invoiceId, accountId, ...payment } = validateSchemaPayload({ schema: paymentSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "PUT", url: "https://api.xero.com/api.xro/2.0/Payments",
          headers: { "Xero-tenant-id": tenant.toLowerCase(), "Idempotency-Key": idempotencyKey },
          body: { Payments: [{ ...payment, Invoice: { InvoiceID: invoiceId }, Account: { AccountID: accountId } }] } };
      },
      validateResult: value => Array.isArray(value?.Payments) && value.Payments.length === 1 && uuid(value.Payments[0]?.PaymentID) &&
        Number.isFinite(value.Payments[0].Amount) && value.Payments[0].HasValidationErrors !== true && !value.Payments[0].ValidationErrors?.length
    },
    "contacts.get": accountingRecord("Contacts", "ContactID", ["accounting.contacts.read", "accounting.contacts"]),
    "contacts.create": contactWrite(false),
    "contacts.update": contactWrite(true),
    "invoices.get": accountingRecord("Invoices", "InvoiceID", ["accounting.invoices.read", "accounting.invoices"]),
    "invoices.create": invoiceWrite(false),
    "invoices.update": invoiceWrite(true),
    "reports.profitAndLoss": accountingRead("Reports/ProfitAndLoss", { fromDate: dateField, toDate: dateField, ...reportFields },
      ["accounting.reports.profitandloss.read"], reportResult),
    "reports.balanceSheet": accountingRead("Reports/BalanceSheet", { date: dateField, ...reportFields },
      ["accounting.reports.balancesheet.read"], reportResult),
    "payments.list": accountingRead("Payments", { page: paging.page, pageSize: { ...paging.pageSize, max: 100 } },
      ["accounting.payments.read", "accounting.payments"],
      (value) => Array.isArray(value?.Payments) && value.Payments.length <= 100 && value.Payments.every((entry) =>
        uuid(entry?.PaymentID) && Number.isFinite(entry.Amount) && typeof entry.Status === "string")),
    "organisation.read": accountingRead("Organisation", {}, ["accounting.settings.read", "accounting.settings"],
      (value) => Array.isArray(value?.Organisations) && value.Organisations.length === 1 && uuid(value.Organisations[0]?.OrganisationID)),
    "contacts.list": accountingRead("Contacts", { ...paging, includeArchived: { type: "boolean", defaultTo: false }, searchTerm: { type: "string", minLength: 1, maxLength: 255 } },
      ["accounting.contacts.read", "accounting.contacts"], (value) => Array.isArray(value?.Contacts) && value.Contacts.length <= 200 && value.Contacts.every((entry) => uuid(entry?.ContactID))),
    "invoices.list": accountingRead("Invoices", paging, ["accounting.invoices.read", "accounting.invoices"],
      (value) => Array.isArray(value?.Invoices) && value.Invoices.length <= 200 && value.Invoices.every((entry) => uuid(entry?.InvoiceID)))
  },
  async exchange(address, options, { request, fetchImpl }) {
    if (address !== connectionsUrl) {
      const tenant = options.headers["Xero-tenant-id"];
      const headers = Object.fromEntries(Object.entries(options.headers).filter(([key]) => ["authorization", "accept"].includes(key.toLowerCase())));
      const connections = await request(connectionsUrl, { ...options, method: "GET", body: undefined, headers });
      if (!validConnections(connections)) throw new ConnectorError("connector_response_invalid", "Xero returned invalid connections.", { statusCode: 502 });
      if (!connections.some((entry) => entry.tenantType === "ORGANISATION" && entry.tenantId.toLowerCase() === tenant)) {
        throw new ConnectorError("connector_permission_denied", "This Xero organisation is not connected to this account.", { statusCode: 403 });
      }
    }
    const attachmentFile = /\/Attachments\/[^/]+$/u.test(new URL(address).pathname);
    if (attachmentFile) {
      const downloading = options.method === "GET";
      const response = await fetchImpl(address, { ...options, credentials: "omit", redirect: "error",
        headers: { ...options.headers, Accept: downloading ? "application/octet-stream" : "application/json" } });
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error("Xero attachment request failed."), { status: response.status });
      }
      const reader = response.body?.getReader(); const chunks = []; let size = 0;
      if (reader) try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 3 * 1024 * 1024) {
            await reader.cancel();
            throw new ConnectorError("connector_response_too_large", "Xero attachment responses are limited to 3 MiB.", { statusCode: 413 });
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      if (downloading) return { contentBase64: bytes.toString("base64"), size,
        contentType: response.headers.get("content-type")?.split(";")[0] || "application/octet-stream" };
      try { return JSON.parse(bytes.toString("utf8")); }
      catch { throw new ConnectorError("connector_response_invalid", "Xero returned an invalid attachment response.", { statusCode: 502 }); }
    }
    const result = await request(address, options);
    const url = new URL(address);
    const record = /^\/api\.xro\/2\.0\/(Contacts|Invoices|Budgets|BankTransactions|ManualJournals)\/([0-9a-f-]+)$/iu.exec(url.pathname);
    if (record) {
      const idName = { Contacts: "ContactID", Invoices: "InvoiceID", Budgets: "BudgetID", BankTransactions: "BankTransactionID", ManualJournals: "ManualJournalID" }[record[1]];
      const returnedId = result?.[record[1]]?.[0]?.[idName];
      if (!uuid(returnedId) || returnedId.toLowerCase() !== record[2].toLowerCase()) {
        throw new ConnectorError("connector_response_invalid", "Xero returned a different record.", { statusCode: 502 });
      }
    }
    if (url.pathname.endsWith("/Organisation") && result?.Organisations?.[0]?.OrganisationID?.toLowerCase() !== options.headers["Xero-tenant-id"]) {
      throw new ConnectorError("connector_response_invalid", "Xero returned a different organisation.", { statusCode: 502 });
    }
    const records = url.pathname.endsWith("/Contacts") ? result?.Contacts : url.pathname.endsWith("/Invoices") ? result?.Invoices : url.pathname.endsWith("/Payments") ? result?.Payments : null;
    if (url.searchParams.has("pageSize") && Array.isArray(records) && records.length > Number(url.searchParams.get("pageSize"))) {
      throw new ConnectorError("connector_response_invalid", "Xero returned more records than requested.", { statusCode: 502 });
    }
    return result;
  }
});
export { xeroProvider };
