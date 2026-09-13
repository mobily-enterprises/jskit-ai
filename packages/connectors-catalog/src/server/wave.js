import { createSchema } from "json-rest-schema";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { waveDefinition } from "../shared/wave.js";
import { graphqlOperation } from "./graphqlOperation.js";

const endpoint = "https://gql.waveapps.com/graphql/public";
const identifier = (value) => typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\s\p{Cc}]/u.test(value);
const businessId = { type: "string", required: true, validator: (value) => identifier(value) || "Choose a business ID returned by Wave." };
const paging = {
  page: { type: "integer", min: 1, max: 2_147_483_647, defaultTo: 1 },
  pageSize: { type: "integer", min: 1, max: 100, defaultTo: 20 }
};
const pageFields = "pageInfo { currentPage totalPages totalCount }";
const validPage = (value, validNode) => Array.isArray(value?.edges) && value.edges.length <= 100 &&
  value.edges.every((edge) => edge?.node === null || validNode(edge?.node)) &&
  Number.isSafeInteger(value.pageInfo?.currentPage) && value.pageInfo.currentPage >= 1 &&
  Number.isSafeInteger(value.pageInfo.totalPages) && value.pageInfo.totalPages >= 0 &&
  Number.isSafeInteger(value.pageInfo.totalCount) && value.pageInfo.totalCount >= value.edges.length;

const decimal = value => typeof value === "string" && /^-?\d+(?:\.\d+)?$/u.test(value);
const namedRecord = value => identifier(value?.id) && typeof value.name === "string";
function businessPage(resource, selection, scopes, validateNode, sort = "") {
  return {
    ...graphqlOperation(endpoint,
      `query ConnectorWave_${resource}($businessId: ID!, $page: Int!, $pageSize: Int!) { business(id: $businessId) { id ${resource}(page: $page, pageSize: $pageSize${sort}) { ${pageFields} edges { node { ${selection} } } } } }`,
      { businessId, ...paging }, data => identifier(data?.business?.id) && validPage(data.business[resource], validateNode)),
    scopes
  };
}

const customerFields = {
          name: { type: "string", minLength: 1, maxLength: 255 },
          firstName: { type: "string", maxLength: 255 },
          lastName: { type: "string", maxLength: 255 },
          email: { type: "string", maxLength: 254 },
          phone: { type: "string", maxLength: 100 },
          mobile: { type: "string", maxLength: 100 },
          displayId: { type: "string", maxLength: 255 },
          internalNotes: { type: "string", maxLength: 10000 }
};

const decimalInput = { type: "none",
  validator: value => typeof value === "string" && value.length <= 100 && /^-?\d+(?:\.\d{1,8})?$/u.test(value) || "Use a decimal string with at most eight decimal places." };
const dateInput = { type: "string", validator: value => /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value || "Use a valid YYYY-MM-DD date." };
const invoiceFields = {
  customerId: businessId,
  status: { type: "string", enum: ["DRAFT", "SAVED"] },
  currency: { type: "string", validator: value => /^[A-Z]{3}$/u.test(value) || "Use a three-letter currency code." },
  title: { type: "string", minLength: 1, maxLength: 255 },
  invoiceNumber: { type: "string", minLength: 1, maxLength: 255 },
  poNumber: { type: "string", maxLength: 255 },
  invoiceDate: dateInput, dueDate: dateInput, exchangeRate: decimalInput,
  memo: { type: "string", maxLength: 10000 }, footer: { type: "string", maxLength: 10000 },
  items: { type: "array", required: true, validator: values => values.length >= 1 && values.length <= 100 || "Use 1–100 invoice items.",
    items: { type: "object", schema: createSchema({
      productId: businessId,
      description: { type: "string", maxLength: 10000 },
      quantity: decimalInput, unitPrice: decimalInput,
      taxes: { type: "array", validator: values => values.length <= 20 || "Use at most 20 taxes per item.",
        items: { type: "object", schema: createSchema({ salesTaxId: businessId }) } }
    }) } }
};
const invoiceSelection = "id invoiceNumber invoiceDate status currency { code } customer { id } business { id } total { value currency { code } } amountDue { value currency { code } } pdfUrl viewUrl";
const validInvoice = value => identifier(value?.id) && typeof value.invoiceNumber === "string" && typeof value.status === "string" &&
  identifier(value.business?.id) && identifier(value.customer?.id) && typeof value.currency?.code === "string" &&
  decimal(value.total?.value) && decimal(value.amountDue?.value);
const productFields = {
  name: { type: "string", minLength: 1, maxLength: 255 },
  description: { type: "string", maxLength: 10000 },
  unitPrice: { type: "none", validator: value => typeof value === "string" && value.length <= 100 && /^-?\d+(?:\.\d{1,5})?$/u.test(value) || "Use a decimal string with at most five decimal places." },
  incomeAccountId: { ...businessId, required: false }, expenseAccountId: { ...businessId, required: false },
  defaultSalesTaxIds: { type: "array", validator: values => values.length <= 20 && new Set(values).size === values.length || "Choose at most 20 distinct taxes.",
    items: businessId }
};
function productMutation(action) {
  return {
    ...graphqlOperation(endpoint,
      `mutation ConnectorWaveProduct${action}($input: Product${action}Input!) { product${action}(input: $input) { didSucceed inputErrors { code path } product { id name unitPrice business { id } } } }`,
      { businessId, input: { type: "object", required: true, schema: createSchema(action === "Create" ? {
        ...productFields, name: { ...productFields.name, required: true }, unitPrice: { ...productFields.unitPrice, required: true }
      } : { ...productFields, id: businessId }) } }, data => {
        const value = data?.[`product${action}`];
        return value?.didSucceed === true && (value.inputErrors === null || (Array.isArray(value.inputErrors) && !value.inputErrors.length)) &&
          namedRecord(value.product) && identifier(value.product.business?.id) && decimal(value.product.unitPrice);
      }), scopes: ["product:write", "product:*"]
  };
}
const transactionAmount = { type: "none", required: true, validator: value => typeof value === "string" && value.length <= 100 &&
  /^\d+(?:\.\d{1,2})?$/u.test(value) && /[1-9]/u.test(value) || "Use a positive decimal-string amount with at most two places." };
const accountSubtypes = ["CASH_AND_BANK", "COST_OF_GOODS_SOLD", "CREDIT_CARD", "CUSTOMER_PREPAYMENTS_AND_CREDITS",
  "DEPRECIATION_AND_AMORTIZATION", "DISCOUNTS", "DUE_FOR_PAYROLL", "DUE_TO_YOU_AND_OTHER_OWNERS", "EXPENSE", "INCOME",
  "INVENTORY", "LOANS", "MONEY_IN_TRANSIT", "NON_RETAINED_EARNINGS", "OTHER_CURRENT_ASSETS", "OTHER_CURRENT_LIABILITY",
  "OTHER_INCOME", "OTHER_LONG_TERM_ASSETS", "OTHER_LONG_TERM_LIABILITY", "PAYABLE", "PAYMENT_PROCESSING_FEES",
  "PAYROLL_EXPENSES", "PROPERTY_PLANT_EQUIPMENT", "RECEIVABLE", "RETAINED_EARNINGS", "VENDOR_PREPAYMENTS_AND_CREDITS"];
const accountFields = { name: productFields.name, description: productFields.description, displayId: { type: "string", maxLength: 255 } };
const taxRate = { type: "none", required: true, validator: value => typeof value === "string" && value.length <= 100 && /^\d+(?:\.\d{1,6})?$/u.test(value) || "Use a nonnegative decimal-string rate with at most six places (0.15 means 15%)." };
const taxFields = { name: productFields.name, abbreviation: { type: "string", minLength: 1, maxLength: 10 },
  description: productFields.description, taxNumber: { type: "string", maxLength: 255 }, showTaxNumberOnInvoices: { type: "boolean" } };
const accountSelection = "id name sequence currency { code } subtype { value } isArchived business { id }";
const taxSelection = "id name abbreviation rate rates { effective rate } isArchived business { id }";
const validAccount = value => namedRecord(value) && identifier(value.business?.id) && Number.isSafeInteger(value.sequence) && value.sequence >= 0 &&
  typeof value.currency?.code === "string" && typeof value.subtype?.value === "string" && typeof value.isArchived === "boolean";
const validTax = value => namedRecord(value) && identifier(value.business?.id) && typeof value.abbreviation === "string" && decimal(value.rate) &&
  typeof value.isArchived === "boolean" && Array.isArray(value.rates) && value.rates.every(rate => typeof rate?.effective === "string" && decimal(rate.rate));
function accountingMutation(kind, action, fields) {
  const resource = kind === "Account" ? "account" : "salesTax";
  const scope = kind === "Account" ? "account" : "sales_tax";
  return {
    ...graphqlOperation(endpoint,
      `mutation ConnectorWave${kind}${action}($input: ${kind}${action}Input!) { ${resource}${action}(input: $input) { didSucceed inputErrors { code path } ${action === "Archive" ? "" : `${resource} { ${kind === "Account" ? accountSelection : taxSelection} }`} } }`,
      { businessId, input: { type: "object", required: true, schema: createSchema(fields) } }, data => {
        const outcome = data?.[`${resource}${action}`];
        return outcome?.didSucceed === true && (outcome.inputErrors === null || (Array.isArray(outcome.inputErrors) && !outcome.inputErrors.length)) &&
          (action === "Archive" || (kind === "Account" ? validAccount(outcome[resource]) : validTax(outcome[resource])));
      }), scopes: [`${scope}:write`, `${scope}:*`]
  };
}
const estimateStatuses = ["ACCEPTED", "APPROVED", "CONVERTED", "DELETED", "DRAFT", "EXPIRED", "REJECTED", "SENT", "VIEWED"];
const estimateFields = {
  customerId: businessId, status: { type: "string", enum: ["DRAFT"], defaultTo: "DRAFT" },
  currency: invoiceFields.currency, title: invoiceFields.title, subhead: { type: "string", maxLength: 255 },
  estimateNumber: invoiceFields.invoiceNumber, poNumber: invoiceFields.poNumber,
  estimateDate: dateInput, dueDate: dateInput, exchangeRate: decimalInput,
  memo: invoiceFields.memo, footer: invoiceFields.footer,
  items: { ...invoiceFields.items, items: { type: "object", schema: createSchema({
    productId: businessId, name: { type: "string", maxLength: 255 },
    description: { type: "string", maxLength: 10000 }, quantity: decimalInput,
    unitPrice: { ...decimalInput, required: true },
    taxes: { type: "array", validator: values => values.length <= 20 || "Use at most 20 taxes per item.",
      items: { type: "object", schema: createSchema({ salesTaxId: businessId }) } }
  }) } }
};
const estimateSelection = "id estimateNumber estimateDate dueDate title status exchangeRate currency { code } customer { id business { id } } total { value currency { code } } amountDue { value currency { code } } pdfUrl viewUrl";
const validEstimate = value => identifier(value?.id) && typeof value.estimateNumber === "string" && estimateStatuses.includes(value.status) &&
  identifier(value.customer?.id) && identifier(value.customer.business?.id) && typeof value.currency?.code === "string" &&
  decimal(value.total?.value) && decimal(value.amountDue?.value);
const sendFields = {
  to: { type: "array", required: true, validator: values => values.length >= 1 && values.length <= 20 || "Use 1–20 recipients.",
    items: { type: "string", maxLength: 254, validator: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) || "Enter an email address." } },
  subject: { type: "string", maxLength: 255 }, message: { type: "string", maxLength: 10000 },
  attachPDF: { type: "boolean", required: true }, ccMyself: { type: "boolean" }
};
function documentMutation(kind, action, fields, permission) {
  const resource = kind.toLowerCase();
  const key = `${resource}${action}`;
  const selection = kind === "Invoice" ? invoiceSelection : estimateSelection;
  const validate = kind === "Invoice" ? validInvoice : validEstimate;
  return {
    ...graphqlOperation(endpoint,
      `mutation ConnectorWave${kind}${action}($input: ${kind}${action}Input!) { ${key}(input: $input) { didSucceed inputErrors { code path } ${action === "Send" ? "" : `${resource} { ${selection} }`} } }`,
      { businessId, input: { type: "object", required: true, schema: createSchema(fields) } },
      data => data?.[key]?.didSucceed === true && (data[key].inputErrors === null ||
        (Array.isArray(data[key].inputErrors) && data[key].inputErrors.length === 0)) &&
        (action === "Send" || validate(data[key][resource]))),
    scopes: [permission, `${resource}:*`]
  };
}

const waveProvider = Object.freeze({
  ...waveDefinition,
  oauth: { issuer: "https://api.waveapps.com", authorization_endpoint: "https://api.waveapps.com/oauth2/authorize/", token_endpoint: "https://api.waveapps.com/oauth2/token/" },
  refreshRequiresRedirectUri: true,
  apiOrigins: ["https://gql.waveapps.com"], checkOperation: "user.read",
  async normalizeTokenResponse(response) {
    if (response.status === 403) {
      throw new ConnectorError("connector_permission_denied", "Wave denied token access. Check the business subscription and permissions.", { statusCode: 403 });
    }
    if (response.ok) {
      let value;
      try { value = await response.clone().json(); } catch { /* reported below */ }
      if (typeof value?.scope !== "string" || !/^[^\s]+(?: [^\s]+)*$/u.test(value.scope)) {
        throw new ConnectorError("connector_response_invalid", "Wave returned an invalid permission grant.", { statusCode: 502 });
      }
    }
    return response;
  },
  operations: {
    "user.read": {
      ...graphqlOperation(endpoint, "query ConnectorWaveUser { user { id firstName lastName defaultEmail } }", {},
        (data) => identifier(data?.user?.id) && typeof data.user.defaultEmail === "string"),
      scopes: ["user:read", "user:*"]
    },
    "businesses.list": {
      ...graphqlOperation(endpoint, `query ConnectorWaveBusinesses($page: Int!, $pageSize: Int!) { businesses(page: $page, pageSize: $pageSize) { ${pageFields} edges { node { id name isPersonal } } } }`, paging,
        (data) => validPage(data?.businesses, (node) => identifier(node?.id) && typeof node.name === "string" && typeof node.isPersonal === "boolean")),
      scopes: ["business:read", "business:*"]
    },
    "customers.list": {
      ...graphqlOperation(endpoint, `query ConnectorWaveCustomers($businessId: ID!, $page: Int!, $pageSize: Int!) { business(id: $businessId) { id customers(page: $page, pageSize: $pageSize, sort: [NAME_ASC]) { ${pageFields} edges { node { id name email } } } } }`, { businessId, ...paging },
        (data) => identifier(data?.business?.id) && validPage(data.business.customers, (node) => identifier(node?.id) && typeof node.name === "string" && (node.email === null || typeof node.email === "string"))),
      scopes: ["customer:read", "customer:*"]
    },
    "accounts.list": businessPage("accounts", "id name currency { code } type { value } subtype { value } isArchived balance",
      ["account:read", "account:*"], node => namedRecord(node) && typeof node.currency?.code === "string" &&
        typeof node.type?.value === "string" && typeof node.subtype?.value === "string" && typeof node.isArchived === "boolean" &&
        (node.balance === null || decimal(node.balance))),
    "products.list": businessPage("products", "id name description unitPrice isSold isBought incomeAccount { id } expenseAccount { id }",
      ["product:read", "product:*"], node => namedRecord(node) && decimal(node.unitPrice) && typeof node.isSold === "boolean" &&
        typeof node.isBought === "boolean" && (node.incomeAccount === null || identifier(node.incomeAccount?.id)) &&
        (node.expenseAccount === null || identifier(node.expenseAccount?.id)), ", sort: [NAME_ASC]"),
    "salesTaxes.list": businessPage("salesTaxes", "id name abbreviation rate isCompound isRecoverable isArchived",
      ["sales_tax:read", "sales_tax:*"], node => namedRecord(node) && typeof node.abbreviation === "string" && decimal(node.rate) &&
        typeof node.isCompound === "boolean" && typeof node.isRecoverable === "boolean" && typeof node.isArchived === "boolean"),
    "vendors.list": businessPage("vendors", "id name email phone",
      ["vendor:read", "vendor:*"], node => namedRecord(node) && (node.email === null || typeof node.email === "string") &&
        (node.phone === null || typeof node.phone === "string")),
    "transactions.create": {
      ...graphqlOperation(endpoint,
        "mutation ConnectorWaveTransactionCreate($input: MoneyTransactionCreateInput!) { moneyTransactionCreate(input: $input) { didSucceed inputErrors { code path } transaction { id } } }",
        { businessId, input: { type: "object", required: true, schema: createSchema({
          externalId: { type: "string", required: true, minLength: 1, maxLength: 255 },
          date: { ...dateInput, required: true }, description: { type: "string", required: true, minLength: 1, maxLength: 10000 },
          notes: { type: "string", maxLength: 10000 },
          anchor: { type: "object", required: true, schema: createSchema({ accountId: businessId, amount: transactionAmount,
            direction: { type: "string", required: true, enum: ["DEPOSIT", "WITHDRAWAL"] } }) },
          lineItems: { type: "array", required: true, validator: values => values.length >= 1 && values.length <= 100 || "Use 1–100 transaction lines.",
            items: { type: "object", schema: createSchema({ accountId: businessId, amount: transactionAmount,
              balance: { type: "string", required: true, enum: ["CREDIT", "DEBIT", "INCREASE", "DECREASE"] },
              customerId: { ...businessId, required: false }, description: { type: "string", maxLength: 10000 },
              taxes: { type: "array", validator: values => values.length <= 20 || "Use at most 20 taxes per line.",
                items: { type: "object", schema: createSchema({ salesTaxId: businessId, amount: transactionAmount }) } }
            }) } }
        }) } }, data => data?.moneyTransactionCreate?.didSucceed === true && identifier(data.moneyTransactionCreate.transaction?.id) &&
          (data.moneyTransactionCreate.inputErrors === null || (Array.isArray(data.moneyTransactionCreate.inputErrors) && !data.moneyTransactionCreate.inputErrors.length))),
      scopes: ["transaction:write", "transaction:*"]
    },
    "accounts.get": {
      ...graphqlOperation(endpoint, `query ConnectorWaveAccountGet($businessId: ID!, $accountId: ID!) { business(id: $businessId) { id account(id: $accountId) { ${accountSelection} } } }`,
        { businessId, accountId: businessId }, data => validAccount(data?.business?.account)), scopes: ["account:read", "account:*"]
    },
    "accounts.create": accountingMutation("Account", "Create", { ...accountFields, name: { ...accountFields.name, required: true },
      subtype: { type: "string", required: true, enum: accountSubtypes }, currency: invoiceFields.currency }),
    "accounts.update": accountingMutation("Account", "Patch", { ...accountFields, id: businessId,
      sequence: { type: "integer", required: true, min: 0, max: 2_147_483_647 } }),
    "accounts.archive": accountingMutation("Account", "Archive", { id: businessId }),
    "salesTaxes.get": {
      ...graphqlOperation(endpoint, `query ConnectorWaveSalesTaxGet($businessId: ID!, $salesTaxId: ID!) { business(id: $businessId) { id salesTax(id: $salesTaxId) { ${taxSelection} } } }`,
        { businessId, salesTaxId: businessId }, data => validTax(data?.business?.salesTax)), scopes: ["sales_tax:read", "sales_tax:*"]
    },
    "salesTaxes.create": accountingMutation("SalesTax", "Create", { ...taxFields, name: { ...taxFields.name, required: true },
      abbreviation: { ...taxFields.abbreviation, required: true }, rate: taxRate, isCompound: { type: "boolean" }, isRecoverable: { type: "boolean" } }),
    "salesTaxes.update": accountingMutation("SalesTax", "Patch", { ...taxFields, id: businessId,
      rates: { type: "array", validator: rates => rates.length >= 1 && rates.length <= 100 && new Set(rates.map(rate => rate.effective)).size === rates.length || "Use 1–100 rates with distinct effective dates.",
        items: { type: "object", schema: createSchema({ effective: { ...dateInput, required: true }, rate: taxRate }) } } }),
    "products.create": productMutation("Create"),
    "products.update": productMutation("Patch"),
    "customers.update": {
      ...graphqlOperation(endpoint,
        "mutation ConnectorWaveCustomerPatch($input: CustomerPatchInput!) { customerPatch(input: $input) { didSucceed inputErrors { code path } customer { id name email business { id } } } }",
        { businessId, input: { type: "object", required: true, schema: createSchema({ id: businessId, ...customerFields }) } },
        data => data?.customerPatch?.didSucceed === true &&
          (data.customerPatch.inputErrors === null || (Array.isArray(data.customerPatch.inputErrors) && !data.customerPatch.inputErrors.length)) &&
          namedRecord(data.customerPatch.customer) && identifier(data.customerPatch.customer.business?.id)),
      scopes: ["customer:write", "customer:*"]
    },
    "customers.create": {
      ...graphqlOperation(endpoint,
        "mutation ConnectorWaveCustomerCreate($input: CustomerCreateInput!) { customerCreate(input: $input) { didSucceed inputErrors { code path } customer { id name email business { id } } } }",
        { input: { type: "object", required: true, schema: createSchema({
          businessId,
          ...customerFields, name: { ...customerFields.name, required: true }
        }) } },
        (data) => data?.customerCreate?.didSucceed === true &&
          (data.customerCreate.inputErrors === null || (Array.isArray(data.customerCreate.inputErrors) && data.customerCreate.inputErrors.length === 0)) &&
          identifier(data.customerCreate.customer?.id) && typeof data.customerCreate.customer.name === "string" &&
          (data.customerCreate.customer.email === null || typeof data.customerCreate.customer.email === "string") &&
          identifier(data.customerCreate.customer.business?.id)),
      scopes: ["customer:write", "customer:*"]
    },
    "invoices.create": documentMutation("Invoice", "Create", { ...invoiceFields, status: { ...invoiceFields.status, defaultTo: "DRAFT" } }, "invoice:write"),
    "invoices.update": documentMutation("Invoice", "Patch", { ...invoiceFields, customerId: { ...businessId, required: false },
      items: { ...invoiceFields.items, required: false }, id: businessId }, "invoice:write"),
    "invoices.approve": documentMutation("Invoice", "Approve", { invoiceId: businessId }, "invoice:write"),
    "invoices.send": documentMutation("Invoice", "Send", {
      invoiceId: businessId,
      ...sendFields
    }, "invoice:send"),
    "estimates.create": documentMutation("Estimate", "Create", estimateFields, "estimate:write"),
    "estimates.update": documentMutation("Estimate", "Patch", {
      ...estimateFields, id: businessId,
      status: { type: "string", required: true, enum: estimateStatuses },
      title: { ...estimateFields.title, required: true }, currency: { ...estimateFields.currency, required: true },
      estimateDate: { ...dateInput, required: true }, dueDate: { ...dateInput, required: true },
      exchangeRate: { ...decimalInput, required: true }, items: { ...estimateFields.items, required: false }
    }, "estimate:write"),
    "estimates.approve": documentMutation("Estimate", "Approve", { estimateId: businessId }, "estimate:write"),
    "estimates.send": documentMutation("Estimate", "Send", { estimateId: businessId, ...sendFields }, "estimate:send"),
    "estimates.list": businessPage("estimates", estimateSelection, ["estimate:read", "estimate:*"], validEstimate, ", sort: CREATED_AT_DESC"),
    "estimates.get": {
      ...graphqlOperation(endpoint,
        `query ConnectorWaveEstimateGet($businessId: ID!, $estimateId: ID!) { business(id: $businessId) { id estimate(id: $estimateId) { ${estimateSelection} } } }`,
        { businessId, estimateId: businessId }, data => identifier(data?.business?.id) && validEstimate(data.business.estimate)),
      scopes: ["estimate:read", "estimate:*"]
    },
    "invoices.get": {
      ...graphqlOperation(endpoint,
        `query ConnectorWaveInvoiceGet($businessId: ID!, $invoiceId: ID!) { business(id: $businessId) { id invoice(id: $invoiceId) { ${invoiceSelection} } } }`,
        { businessId, invoiceId: businessId }, data => identifier(data?.business?.id) && validInvoice(data.business.invoice)),
      scopes: ["invoice:read", "invoice:*"]
    },
    "invoices.list": {
      ...graphqlOperation(endpoint, `query ConnectorWaveInvoices($businessId: ID!, $page: Int!, $pageSize: Int!) { business(id: $businessId) { id invoices(page: $page, pageSize: $pageSize, sort: [CREATED_AT_DESC]) { ${pageFields} edges { node { id invoiceNumber invoiceDate status currency { code } } } } } }`, { businessId, ...paging },
        (data) => identifier(data?.business?.id) && validPage(data.business.invoices, (node) => identifier(node?.id) &&
          typeof node.invoiceNumber === "string" && typeof node.invoiceDate === "string" && typeof node.status === "string" && typeof node.currency?.code === "string")),
      scopes: ["invoice:read", "invoice:*"]
    }
  },
  async exchange(address, options, { request: transport }) {
    const request = async (url, init) => {
      const result = await transport(url, init);
      if (Array.isArray(result?.errors) && result.errors.length) {
        const codes = result.errors.map((error) => error?.extensions?.code);
        if (codes.includes("UNAUTHENTICATED")) throw new ConnectorError("connector_reconnect_required", "Connect this Wave account again.", { statusCode: 401 });
        if (codes.includes("NOT_FOUND")) throw new ConnectorError("connector_resource_not_found", "This Wave resource is not available.", { statusCode: 404 });
        throw new ConnectorError("connector_provider_failed", "Wave could not complete this query.", { statusCode: 502 });
      }
      return result;
    };
    const variables = options.body.variables;
    const patchCustomer = options.body.query.startsWith("mutation ConnectorWaveCustomerPatch(");
    const documentMatch = /^mutation ConnectorWave(Invoice|Estimate)(Create|Patch|Approve|Send)\(/u.exec(options.body.query);
    const documentKind = documentMatch?.[1];
    const documentAction = documentMatch?.[2];
    const resource = documentKind?.toLowerCase();
    const transactionCreate = options.body.query.startsWith("mutation ConnectorWaveTransactionCreate(");
    if (transactionCreate) {
      const values = variables.input;
      const related = new Map();
      related.set(`account:${values.anchor.accountId}`, { field: "account", id: values.anchor.accountId });
      for (const line of values.lineItems) {
        related.set(`account:${line.accountId}`, { field: "account", id: line.accountId });
        if (line.customerId) related.set(`customer:${line.customerId}`, { field: "customer", id: line.customerId });
        for (const tax of line.taxes || []) related.set(`salesTax:${tax.salesTaxId}`, { field: "salesTax", id: tax.salesTaxId });
      }
      if (related.size > 100) throw new ConnectorError("connector_input_invalid", "Use at most 100 distinct related records per transaction.", { statusCode: 422 });
      for (const target of related.values()) {
        const owner = await request(address, { ...options, body: {
          query: `query ConnectorWaveTransactionOwner($businessId: ID!, $id: ID!) { business(id: $businessId) { id record: ${target.field}(id: $id) { id business { id } } } }`,
          variables: { businessId: variables.businessId, id: target.id }
        } });
        if (owner?.data?.business?.id !== variables.businessId || owner.data.business.record?.id !== target.id ||
            owner.data.business.record.business?.id !== variables.businessId) {
          throw new ConnectorError("connector_resource_not_found", "A transaction account, customer or tax is not available in the selected business. Check read access.", { statusCode: 404 });
        }
      }
      options = { ...options, body: { ...options.body, variables: { input: { ...values, businessId: variables.businessId } } } };
    }
    const accountingMatch = /^mutation ConnectorWave(Account|SalesTax)(Create|Patch|Archive)\(/u.exec(options.body.query);
    const accountingResource = accountingMatch?.[1] === "Account" ? "account" : "salesTax";
    if (accountingMatch) {
      const values = variables.input;
      if (accountingMatch[2] !== "Create") {
        const changedFields = Object.keys(values).filter(key => key !== "id" && key !== "sequence");
        if (accountingMatch[2] === "Patch" && !changedFields.length) throw new ConnectorError("connector_input_invalid", "Choose accounting fields to update.", { statusCode: 422 });
        const existing = await request(address, { ...options, body: {
          query: `query ConnectorWaveAccountingOwner($businessId: ID!, $id: ID!) { business(id: $businessId) { id record: ${accountingResource}(id: $id) { id business { id } ${accountingResource === "account" ? "sequence" : ""} } } }`,
          variables: { businessId: variables.businessId, id: values.id }
        } });
        if (existing?.data?.business?.id !== variables.businessId || existing.data.business.record?.id !== values.id ||
            existing.data.business.record.business?.id !== variables.businessId) {
          throw new ConnectorError("connector_resource_not_found", "This accounting record is not available in the selected business. Check read access.", { statusCode: 404 });
        }
        if (accountingMatch[2] === "Patch" && accountingResource === "account" && existing.data.business.record.sequence !== values.sequence) {
          throw new ConnectorError("connector_conflict", "The account changed. Reload it before applying your edit.", { statusCode: 409 });
        }
      }
      options = { ...options, body: { ...options.body, variables: { input: accountingMatch[2] === "Create" ? { ...values, businessId: variables.businessId } : values } } };
    }
    const productAction = /^mutation ConnectorWaveProduct(Create|Patch)\(/u.exec(options.body.query)?.[1];
    if (productAction) {
      const values = variables.input;
      if (productAction === "Patch" && Object.keys(values).length < 2) {
        throw new ConnectorError("connector_input_invalid", "Choose at least one product field to update.", { statusCode: 422 });
      }
      const related = [];
      if (productAction === "Patch") related.push({ field: "product", id: values.id });
      for (const field of ["incomeAccountId", "expenseAccountId"]) {
        if (values[field]) related.push({ field: "account", id: values[field] });
      }
      for (const id of values.defaultSalesTaxIds || []) related.push({ field: "salesTax", id });
      for (const target of related) {
        const owner = await request(address, { ...options, body: {
          query: `query ConnectorWaveProductRelated($businessId: ID!, $id: ID!) { business(id: $businessId) { id record: ${target.field}(id: $id) { id business { id } } } }`,
          variables: { businessId: variables.businessId, id: target.id }
        } });
        if (owner?.data?.business?.id !== variables.businessId ||
            owner.data.business.record?.id !== target.id || owner.data.business.record.business?.id !== variables.businessId) {
          throw new ConnectorError("connector_resource_not_found", "This product, account or tax is not available in the selected business. Check read access.", { statusCode: 404 });
        }
      }
      options = { ...options, body: { ...options.body, variables: { input: productAction === "Create" ? { ...values, businessId: variables.businessId } : values } } };
    }
    if (documentAction) {
      const values = variables.input;
      if (documentAction === "Patch" && Object.keys(values).length < 2) {
        throw new ConnectorError("connector_input_invalid", "Choose at least one document field to update.", { statusCode: 422 });
      }
      const targetId = values.id || values[`${resource}Id`];
      if (targetId) {
        const existing = await request(address, { ...options, body: {
          query: `query ConnectorWave${documentKind}Owner($businessId: ID!, $id: ID!) { business(id: $businessId) { id emailSendEnabled ${resource}(id: $id) { id status ${resource === "invoice" ? "business { id }" : "customer { id business { id } }"} } } }`,
          variables: { businessId: variables.businessId, id: targetId }
        } });
        if (existing?.data?.business?.id !== variables.businessId ||
            existing.data.business[resource]?.id !== targetId || (resource === "invoice" ? existing.data.business[resource].business?.id : existing.data.business[resource].customer?.business?.id) !== variables.businessId) {
          throw new ConnectorError("connector_resource_not_found", "This document is not available in the selected business. Check read access.", { statusCode: 404 });
        }
        const status = existing.data.business[resource].status;
        if (documentAction === "Send" && ((resource === "invoice" && existing.data.business.emailSendEnabled !== true) ||
            typeof status !== "string" || !status || status === "DRAFT" ||
            (resource === "estimate" && !["APPROVED", "SENT", "VIEWED", "ACCEPTED"].includes(status)))) {
          throw new ConnectorError("connector_input_invalid", "Approve the document and check Wave email eligibility before sending.", { statusCode: 422 });
        }
      }
      if (values.customerId) {
        const owner = await request(address, { ...options, body: {
          query: "query ConnectorWaveInvoiceCustomer($businessId: ID!, $id: ID!) { business(id: $businessId) { id customer(id: $id) { id business { id } } } }",
          variables: { businessId: variables.businessId, id: values.customerId }
        } });
        if (owner?.data?.business?.id !== variables.businessId || owner.data.business.customer?.id !== values.customerId ||
            owner.data.business.customer.business?.id !== variables.businessId) {
          throw new ConnectorError("connector_resource_not_found", "This customer is not available in the selected business. Check read access.", { statusCode: 404 });
        }
      }
      options = { ...options, body: { ...options.body, variables: { input: documentAction === "Create" ? { ...values, businessId: variables.businessId } : values } } };
    }
    if (patchCustomer) {
      if (Object.keys(variables.input).length < 2) {
        throw new ConnectorError("connector_input_invalid", "Choose at least one customer field to update.", { statusCode: 422 });
      }
      const existing = await request(address, { ...options, body: {
        query: "query ConnectorWaveCustomerOwner($businessId: ID!, $id: ID!) { business(id: $businessId) { id customer(id: $id) { id business { id } } } }",
        variables: { businessId: variables.businessId, id: variables.input.id }
      } });
      if (existing?.data?.business?.id !== variables.businessId || existing.data.business.customer?.id !== variables.input.id ||
          existing.data.business.customer.business?.id !== variables.businessId) {
        throw new ConnectorError("connector_resource_not_found", "This customer is not available in the selected business.", { statusCode: 404 });
      }
      // Business selection is a local authorization input; CustomerPatchInput only takes its customer ID.
      options = { ...options, body: { ...options.body, variables: { input: variables.input } } };
    }
    const result = await request(address, options);
    if (transactionCreate) {
      if (result?.data?.moneyTransactionCreate?.didSucceed === false) {
        throw new ConnectorError("connector_input_invalid", "Wave rejected the transaction. Review its balance, accounts and details before submitting again.", { statusCode: 422 });
      }
      return result;
    }
    if (accountingMatch) {
      const outcome = result?.data?.[`${accountingResource}${accountingMatch[2]}`];
      if (outcome?.didSucceed === false) throw new ConnectorError("connector_input_invalid", "Wave rejected the accounting change. Check the values and current record.", { statusCode: 422 });
      if (outcome?.didSucceed === true && accountingMatch[2] !== "Archive" && (outcome[accountingResource]?.business?.id !== variables.businessId ||
          (variables.input.id && outcome[accountingResource]?.id !== variables.input.id))) {
        throw new ConnectorError("connector_response_invalid", "Wave returned an unexpected accounting record. Check the outcome before retrying.", { statusCode: 502 });
      }
      return result;
    }
    if (productAction) {
      const value = result?.data?.[`product${productAction}`];
      if (value?.didSucceed === false) {
        throw new ConnectorError("connector_input_invalid", "Wave rejected the product details. Check accounts, taxes and price.", { statusCode: 422 });
      }
      if (value?.didSucceed === true && (value.product?.business?.id !== variables.businessId ||
          (productAction === "Patch" && value.product?.id !== variables.input.id))) {
        throw new ConnectorError("connector_response_invalid", "Wave returned an unexpected product. Check the outcome before retrying.", { statusCode: 502 });
      }
      return result;
    }
    if (documentAction) {
      const outcome = result?.data?.[`${resource}${documentAction}`];
      if (outcome?.didSucceed === false) {
        throw new ConnectorError("connector_input_invalid", "Wave rejected the document operation. Check its details and current state.", { statusCode: 422 });
      }
      if (outcome?.didSucceed === true && documentAction !== "Send" &&
          ((resource === "invoice" ? outcome[resource]?.business?.id : outcome[resource]?.customer?.business?.id) !== variables.businessId ||
           ((variables.input.id || variables.input[`${resource}Id`]) && outcome[resource]?.id !== (variables.input.id || variables.input[`${resource}Id`])) ||
           (variables.input.customerId && outcome[resource]?.customer?.id !== variables.input.customerId))) {
        throw new ConnectorError("connector_response_invalid", "Wave returned an unexpected document. Check the outcome before retrying.", { statusCode: 502 });
      }
      return result;
    }
    const mutation = patchCustomer ? result?.data?.customerPatch : result?.data?.customerCreate;
    if (mutation?.didSucceed === false) {
      throw new ConnectorError("connector_input_invalid", "Wave rejected the customer details. Check the selected business and customer fields.", { statusCode: 422 });
    }
    if (mutation?.didSucceed === true && mutation.customer?.business?.id !== (patchCustomer ? variables.businessId : variables.input?.businessId)) {
      throw new ConnectorError("connector_response_invalid", "Wave returned a customer from an unexpected business. Check the outcome before retrying.", { statusCode: 502 });
    }
    if (!patchCustomer && variables.businessId && result?.data?.business?.id !== variables.businessId) {
      throw new ConnectorError("connector_response_invalid", "Wave returned an unexpected business.", { statusCode: 502 });
    }
    if (patchCustomer && mutation?.customer?.id !== variables.input.id) {
      throw new ConnectorError("connector_response_invalid", "Wave returned an unexpected customer. Check the outcome before retrying.", { statusCode: 502 });
    }
    if (variables.invoiceId && (result?.data?.business?.invoice?.id !== variables.invoiceId ||
        result?.data?.business?.invoice?.business?.id !== variables.businessId)) {
      throw new ConnectorError("connector_response_invalid", "Wave returned an unexpected invoice.", { statusCode: 502 });
    }
    if (variables.estimateId && (result?.data?.business?.estimate?.id !== variables.estimateId ||
        result?.data?.business?.estimate?.customer?.business?.id !== variables.businessId)) {
      throw new ConnectorError("connector_response_invalid", "Wave returned an unexpected estimate.", { statusCode: 502 });
    }
    if (result?.data?.business?.estimates?.edges?.some(edge => edge?.node?.customer?.business?.id !== variables.businessId)) {
      throw new ConnectorError("connector_response_invalid", "Wave returned an estimate from another business.", { statusCode: 502 });
    }
    for (const field of ["account", "salesTax"]) {
      if (variables[`${field}Id`] && (result?.data?.business?.[field]?.id !== variables[`${field}Id`] ||
          result?.data?.business?.[field]?.business?.id !== variables.businessId)) {
        throw new ConnectorError("connector_response_invalid", "Wave returned an unexpected accounting record.", { statusCode: 502 });
      }
    }
    const page = result?.data?.businesses || Object.values(result?.data?.business || {}).find(value => value && typeof value === "object" && Object.hasOwn(value, "pageInfo"));
    if (page && (page.pageInfo?.currentPage !== variables.page || page.edges?.length > variables.pageSize)) {
      throw new ConnectorError("connector_response_invalid", "Wave returned an unexpected page.", { statusCode: 502 });
    }
    return result;
  }
});
export { waveProvider };
