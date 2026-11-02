import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { appErrorCode } from "../plugin/rules/appErrorCode.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/app-error-code", appErrorCode, {
  valid: [
    "throw new AppError(404, \"Invoice was not found.\", { code: \"billing.invoice.notFound\" });",
    "throw new AppError(422, \"Name is too short.\", { code: \"billing.name.tooShort\", params: { min: 3 } });",
    "throw new NotFoundError(\"Invoice was not found.\", { code: \"billing.invoice.notFound\" });",
    "throw new AppError(status, message, options);",
    "throw new AppError(400, message, { ...options, details });",
    "throw new Error(\"The ledger is out of order.\");",
    "throw new DomainValidationError({ name: \"Required.\" });",
    [
      "class InvoiceLockedError extends AppError {",
      "  constructor() { super(409, \"The invoice is locked.\", { code: \"billing.invoice.locked\" }); }",
      "}",
      "throw new InvoiceLockedError();"
    ].join("\n"),
    [
      "throw new AppError(400, \"Choose a plan.\", { code: \"billing.input.invalid\", messageCode: \"billing.plan.missing\" });",
      "throw new AppError(400, \"Choose a currency.\", { code: \"billing.input.invalid\", messageCode: \"billing.currency.missing\" });"
    ].join("\n"),
    [
      "throw new AppError(404, \"Invoice was not found.\", { code: \"billing.invoice.notFound\" });",
      "throw new AppError(404, \"Invoice was not found.\", { code: \"billing.invoice.notFound\" });"
    ].join("\n"),
    [
      "class SignInError extends AppError {",
      "  constructor(message, code) { super(401, message, { code }); }",
      "}",
      "throw new SignInError(\"Sign in to continue.\", \"realtime.auth.required\");"
    ].join("\n"),
    "class LockedError extends ConflictError {}\nthrow new LockedError(\"The invoice is locked.\", { code: \"billing.invoice.locked\" });",
    "class SessionError extends AppError {\n  constructor(message, { code }) { super(401, message, { code }); }\n}\nthrow new SessionError(\"Session refresh required.\", { code: \"realtime.session.refresh\" });",
    "// readable-check: allow app-error-code - data: the code comes from the provider's refusal\nthrow new AppError(502, \"The provider refused.\");",
    [
      "class ApprovalError extends AppError {",
      "  constructor(message, { approval, ...options }) {",
      "    super(403, message, options);",
      "    this.approval = approval;",
      "  }",
      "}",
      "throw new ApprovalError(\"Ask your admin to approve the app.\", { approval: link, code: \"connections.approval.required\" });"
    ].join("\n"),
    [
      "class ApprovalError extends AppError {",
      "  constructor(message, { approval, ...options }) { super(403, message, { ...options, details: { approval } }); }",
      "}",
      "throw new ApprovalError(\"Ask your admin to approve the app.\", { approval: link, code: \"connections.approval.required\" });"
    ].join("\n")
  ],
  invalid: [
    {
      code: "throw new AppError(404, \"Invoice was not found.\");",
      errors: [{ messageId: "missingCode", data: { name: "AppError" } }]
    },
    {
      code: "throw new AppError(404, \"Invoice was not found.\", { details: { id } });",
      errors: [{ messageId: "missingCode", data: { name: "AppError" } }]
    },
    {
      code: "throw new NotFoundError(\"Invoice was not found.\");",
      errors: [{ messageId: "missingCode", data: { name: "NotFoundError" } }]
    },
    {
      code: "throw new ConflictError(\"The invoice is locked.\", { details: { id } });",
      errors: [{ messageId: "missingCode", data: { name: "ConflictError" } }]
    },
    {
      code: [
        "class BillingError extends AppError {",
        "  constructor(status, message, options = {}) { super(status, message, { ...options, code: options.code || \"billing_error\" }); }",
        "}",
        "throw new BillingError(400, \"Choose a plan.\");"
      ].join("\n"),
      errors: [{ messageId: "missingCode", data: { name: "BillingError" }, line: 4 }]
    },
    {
      code: "class SignInError extends AppError {\n  constructor(message, code) { super(401, message, { code }); }\n}\nthrow new SignInError(\"Sign in to continue.\");",
      errors: [{ messageId: "missingCode", data: { name: "SignInError" }, line: 4 }]
    },
    {
      code: "class LockedError extends ConflictError {}\nthrow new LockedError(\"The invoice is locked.\");",
      errors: [{ messageId: "missingCode", data: { name: "LockedError" }, line: 2 }]
    },
    {
      code: "class SessionError extends AppError {\n  constructor(message, { code } = {}) { super(401, message, { code }); }\n}\nthrow new SessionError(\"Session refresh required.\", {});",
      errors: [{ messageId: "missingCode", data: { name: "SessionError" }, line: 4 }]
    },
    {
      code: [
        "class ApprovalError extends AppError {",
        "  constructor(message, { approval, ...options }) {",
        "    super(403, message, options);",
        "    this.approval = approval;",
        "  }",
        "}",
        "throw new ApprovalError(\"Ask your admin to approve the app.\", { approval: link });"
      ].join("\n"),
      errors: [{ messageId: "missingCode", data: { name: "ApprovalError" }, line: 7 }]
    },
    {
      code: [
        "class ApprovalError extends AppError {",
        "  constructor(message, { approval, ...options }) { super(403, message); }",
        "}",
        "throw new ApprovalError(\"Ask your admin to approve the app.\", { approval: link, code: \"connections.approval.required\" });"
      ].join("\n"),
      errors: [{ messageId: "missingCode", data: { name: "ApprovalError" }, line: 4 }]
    },
    {
      code: [
        "throw new AppError(400, \"Choose a plan.\", { code: \"billing.input.invalid\" });",
        "throw new AppError(400, \"Choose a currency.\", { code: \"billing.input.invalid\" });"
      ].join("\n"),
      errors: [{ messageId: "sharedCode", data: { code: "billing.input.invalid", line: 1 }, line: 2 }]
    }
  ]
});
