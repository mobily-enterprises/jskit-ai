import { normalizeInteger, normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { RepositoryError } from "./runtimeErrors.js";

function buildPaginationMeta({ total, page, pageSize } = {}) {
  const normalizedTotal = Math.max(0, normalizeInteger(total, { fallback: 0 }));
  const normalizedPageSize = Math.max(1, normalizeInteger(pageSize, { fallback: 25 }));
  const normalizedPage = Math.max(1, normalizeInteger(page, { fallback: 1 }));
  const pageCount = Math.max(1, Math.ceil(normalizedTotal / normalizedPageSize));

  return Object.freeze({
    total: normalizedTotal,
    page: Math.min(normalizedPage, pageCount),
    pageSize: normalizedPageSize,
    pageCount,
    hasPrev: normalizedPage > 1,
    hasNext: normalizedPage < pageCount
  });
}

class BaseRepository {
  constructor({ knex, transactionManager } = {}) {
    if (!knex) {
      throw new RepositoryError("BaseRepository requires knex.");
    }
    if (!transactionManager || typeof transactionManager.inTransaction !== "function") {
      throw new RepositoryError("BaseRepository requires transactionManager.inTransaction().");
    }

    this.knex = knex;
    this.transactionManager = transactionManager;
  }

  async withTransaction(work, options = {}) {
    if (typeof work !== "function") {
      throw new RepositoryError("withTransaction requires a callback.");
    }

    return this.transactionManager.inTransaction(work, normalizeObject(options));
  }

  paginateRows(rows = [], options = {}) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const pageSize = Math.max(1, normalizeInteger(options.pageSize, { fallback: 25 }));
    const page = Math.max(1, normalizeInteger(options.page, { fallback: 1 }));
    const meta = buildPaginationMeta({
      total: sourceRows.length,
      page,
      pageSize
    });

    const start = (meta.page - 1) * meta.pageSize;
    const end = start + meta.pageSize;

    return Object.freeze({
      rows: Object.freeze(sourceRows.slice(start, end)),
      meta
    });
  }
}

export { BaseRepository, buildPaginationMeta };
