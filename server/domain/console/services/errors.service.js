import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { hasPermission, resolveRolePermissions } from "../policies/roles.js";

const BROWSER_ERRORS_READ_PERMISSION = "console.errors.browser.read";
const SERVER_ERRORS_READ_PERMISSION = "console.errors.server.read";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function normalizeString(value, maxLength = 0) {
  const normalized = String(value || "").trim();
  if (!maxLength || normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength);
}

function normalizeStack(value, maxLength = 16000) {
  const normalized = String(value || "");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength);
}

function normalizeObject(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  if (Array.isArray(value)) {
    return {
      items: value.slice(0, 10)
    };
  }

  const clone = {};
  for (const [key, item] of Object.entries(value)) {
    if (Object.keys(clone).length >= 30) {
      clone.__truncated = true;
      break;
    }

    const normalizedKey = normalizeString(key, 120);
    if (!normalizedKey) {
      continue;
    }

    if (item == null || typeof item === "boolean" || typeof item === "number") {
      clone[normalizedKey] = item;
      continue;
    }

    if (typeof item === "string") {
      clone[normalizedKey] = normalizeString(item, 800);
      continue;
    }

    if (Array.isArray(item)) {
      clone[normalizedKey] = item.slice(0, 10);
      continue;
    }

    if (typeof item === "object") {
      clone[normalizedKey] = "[object]";
    }
  }

  return clone;
}

function normalizeIsoDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizePagination(pagination) {
  const rawPage = parsePositiveInteger(pagination?.page);
  const rawPageSize = parsePositiveInteger(pagination?.pageSize);

  return {
    page: rawPage || DEFAULT_PAGE,
    pageSize: Math.max(1, Math.min(MAX_PAGE_SIZE, rawPageSize || DEFAULT_PAGE_SIZE))
  };
}

function normalizeBrowserPayload(payload, user) {
  const body = payload && typeof payload === "object" ? payload : {};
  const metadata = normalizeObject(body.metadata);

  return {
    occurredAt: normalizeIsoDate(body.occurredAt),
    source: normalizeString(body.source || "window.error", 48) || "window.error",
    errorName: normalizeString(body.errorName || body.name, 160),
    message: normalizeString(body.message || body.reason || "Unknown browser error", 2000),
    stack: normalizeStack(body.stack, 16000),
    url: normalizeString(body.url, 2048),
    path: normalizeString(body.path, 2048),
    surface: normalizeString(body.surface, 64),
    userAgent: normalizeString(body.userAgent, 1024),
    lineNumber: parsePositiveInteger(body.lineNumber || body.line),
    columnNumber: parsePositiveInteger(body.columnNumber || body.column),
    userId: parsePositiveInteger(user?.id),
    username: normalizeString(user?.displayName || user?.email || "", 160),
    metadata
  };
}

function normalizeServerPayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};

  return {
    requestId: normalizeString(body.requestId, 128),
    method: normalizeString(body.method, 16),
    path: normalizeString(body.path, 2048),
    statusCode: parsePositiveInteger(body.statusCode) || 500,
    errorName: normalizeString(body.errorName, 160),
    message: normalizeString(body.message || "Unknown server error", 2000),
    stack: normalizeStack(body.stack, 16000),
    userId: parsePositiveInteger(body.userId),
    username: normalizeString(body.username, 160),
    metadata: normalizeObject(body.metadata)
  };
}

function createService({ consoleMembershipsRepository, consoleErrorLogsRepository }) {
  if (!consoleMembershipsRepository || !consoleErrorLogsRepository) {
    throw new Error("console error service repositories are required.");
  }

  async function requirePermission(user, permission) {
    const userId = parsePositiveInteger(user?.id);
    if (!userId) {
      throw new AppError(401, "Authentication required.");
    }

    const membership = await consoleMembershipsRepository.findByUserId(userId);
    if (!membership || membership.status !== "active") {
      throw new AppError(403, "Forbidden.");
    }

    const permissions = resolveRolePermissions(membership.roleId);
    if (!hasPermission(permissions, permission)) {
      throw new AppError(403, "Forbidden.");
    }

    return {
      userId,
      membership,
      permissions
    };
  }

  async function listBrowserErrors(user, pagination) {
    await requirePermission(user, BROWSER_ERRORS_READ_PERMISSION);
    const { page, pageSize } = normalizePagination(pagination);

    const total = await consoleErrorLogsRepository.countBrowserErrors();
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const entries = await consoleErrorLogsRepository.listBrowserErrors(safePage, pageSize);

    return {
      entries,
      page: safePage,
      pageSize,
      total,
      totalPages
    };
  }

  async function listServerErrors(user, pagination) {
    await requirePermission(user, SERVER_ERRORS_READ_PERMISSION);
    const { page, pageSize } = normalizePagination(pagination);

    const total = await consoleErrorLogsRepository.countServerErrors();
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const entries = await consoleErrorLogsRepository.listServerErrors(safePage, pageSize);

    return {
      entries,
      page: safePage,
      pageSize,
      total,
      totalPages
    };
  }

  async function recordBrowserError({ payload, user }) {
    const normalizedPayload = normalizeBrowserPayload(payload, user);
    return consoleErrorLogsRepository.insertBrowserError(normalizedPayload);
  }

  async function recordServerError(payload) {
    const normalizedPayload = normalizeServerPayload(payload);
    return consoleErrorLogsRepository.insertServerError(normalizedPayload);
  }

  return {
    listBrowserErrors,
    listServerErrors,
    recordBrowserError,
    recordServerError
  };
}

export {
  BROWSER_ERRORS_READ_PERMISSION,
  SERVER_ERRORS_READ_PERMISSION,
  normalizePagination,
  normalizeBrowserPayload,
  normalizeServerPayload,
  createService
};
