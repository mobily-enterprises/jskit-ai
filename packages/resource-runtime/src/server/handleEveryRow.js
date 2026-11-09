import { RestApiRowLimitError } from "json-rest-api";
import { isJobContext } from "./contexts.js";
import { checkBlobReads, namedBlobs } from "./handleBlobs.js";
import { RowLimitError } from "./errors.js";
import { matchesNoRow } from "./handleGuards.js";
import { handleRecords, readQueryParams } from "./handleRecords.js";
import { reportedPageRead } from "./manyRowChannel.js";
import { returnBadRequestWhenJsonRestFieldsetInvalid } from "./resourceHost.js";

/**
 * A handle's reads of every row its filters match: queryAll, which answers them at once, and queryPages, which hands
 * them over a page at a time. Both read in cursor pages of `settings.serverPageSize` rows and, in a request context,
 * stop past `settings.requestRowLimit` rows; a system context, and the workspace and user contexts it derives, read
 * without a limit.
 * @param {object} dependencies
 * @param {{ knex: { instance: any } }} dependencies.api The table's json-rest-api, whose Knex sends its statements.
 * @param {string} dependencies.name The resource's name.
 * @param {{ name: string, schema: Record<string, any> }} dependencies.resource
 * @param {() => any} dependencies.jsonRest The table's json-rest-api resource.
 * @param {(params: { fields?: unknown }, kind: "list") => unknown} dependencies.readFields The fields a read names.
 * @param {(options: object) => object} dependencies.contextOf The call's json-rest-api context, after its scope checks.
 * @param {import("./types.js").HiddenFieldReads} dependencies.hiddenFields The hidden
 *   fields a read names, read after it.
 * @param {{ requestRowLimit: number, serverPageSize: number }} dependencies.settings
 * @param {(name: string) => (import("@jskit-ai/resource-core/shared/tableResource").TableResource | null)} dependencies.resourceNamed
 *   The application's table resources by name, which shape included records.
 */
function createEveryRowReads({ api, name, resource, jsonRest, readFields, contextOf, hiddenFields, settings, resourceNamed }) {
  // queryAll() and queryPages() read without a row limit in a system context and the workspace and user contexts it derives.
  const rowLimitOf = (options) => (isJobContext(options.context) ? undefined : settings.requestRowLimit);

  /**
   * Every record the filters match, read in pages of pageLimits().server rows in
   * id order (or `sort`). In a request it throws past the request row limit
   * (pageLimits().requestRows); a system context, and the workspace and user
   * contexts it derives, read without one, holding every row in memory:
   * queryPages() reads them a page at a time.
   * @param {{ filters?: object, sort?: string | string[], include?: string | string[], fields?: string[] | object }} [params]
   * @param {{ context?: object | null, trx?: object | null }} [options]
   */
  async function queryAll(params = {}, options = {}) {
    const context = contextOf(options);
    const rowLimit = rowLimitOf(options);
    checkBlobReads(name, "queryAll", namedBlobs(resource, params.fields, resourceNamed), Infinity);
    const read = { ...params, fields: readFields(params, "list") };
    const queryParams = readQueryParams(resource, read, { page: false, caller: "queryAll" });
    const hidden = hiddenFields.named(params.fields, "plain");
    try {
      const payload = matchesNoRow(params.filters, jsonRest().vars.schemaInfo)
        ? { data: [] }
        : await returnBadRequestWhenJsonRestFieldsetInvalid(() => jsonRest().queryAll(
          {
            queryParams,
            pageSize: settings.serverPageSize,
            ...(rowLimit === undefined ? {} : { rowLimit }),
            transaction: options.trx || undefined,
            format: "plain"
          },
          context
        ));
      return await hiddenFields.add(handleRecords(resource, payload.data, read, resourceNamed), hidden, options);
    } catch (error) {
      if (error instanceof RestApiRowLimitError && rowLimit !== undefined) {
        throw new RowLimitError(name, rowLimit, error);
      }
      throw error;
    }
  }

  /**
   * The records queryAll() answers, handed over a page at a time, so work over
   * many rows holds one page in memory: `for await (const records of
   * queryPages(params, options))`. Each page is one statement of at most
   * pageLimits().server rows (fewer when its fields name blobs, so the page holds
   * at most 16 MiB of them), plus the statements that read its includes and the
   * hidden fields it names, in id order (or `sort`). Each page continues after the
   * last row of the page before, by its sort values: a write between pages that
   * changes what the filters match, but not the sort fields' values, skips and
   * repeats none of the rows still to come, while a row whose sort values move
   * past the cursor is read again or not at all. In a request it throws
   * RowLimitError instead of answering the page that takes it past the request
   * row limit, as queryAll() does; background work reads without one.
   * @param {{ filters?: object, sort?: string | string[], include?: string | string[], fields?: string[] | object }} [params]
   * @param {{ context?: object | null, trx?: object | null }} [options]
   * @returns {AsyncGenerator<object[], void, undefined>}
   */
  async function* queryPages(params = {}, options = {}) {
    const context = contextOf(options);
    const rowLimit = rowLimitOf(options);
    const read = { ...params, fields: readFields(params, "list") };
    const queryParams = readQueryParams(resource, read, { page: false, caller: "queryPages" });
    const hidden = hiddenFields.named(params.fields, "plain");
    if (matchesNoRow(params.filters, jsonRest().vars.schemaInfo)) {
      return;
    }
    const size = Math.min(settings.serverPageSize, checkBlobReads(name, "queryPages", namedBlobs(resource, params.fields, resourceNamed)));
    const sort = queryParams.sort?.length ? queryParams.sort : ["id"];
    let rows = 0;
    let after;
    // One page: its statement, its includes' and its hidden fields' read. Answers its records, or null when it has none.
    const page = async () => {
      const payload = await returnBadRequestWhenJsonRestFieldsetInvalid(() => jsonRest().query(
        {
          queryParams: { ...queryParams, sort, page: after === undefined ? { size } : { size, after } },
          pageSizeLimit: size,
          transaction: options.trx || undefined,
          format: "plain"
        },
        { ...context }
      ));
      rows += payload.data.length;
      if (rowLimit !== undefined && rows > rowLimit) {
        throw new RowLimitError(name, rowLimit, undefined, "queryPages");
      }
      const pagination = payload.meta?.pagination;
      after = pagination?.hasMore === true ? pagination.cursor?.next ?? undefined : undefined;
      return payload.data.length > 0 ? hiddenFields.add(handleRecords(resource, payload.data, read, resourceNamed), hidden, options) : null;
    };
    let records = await page();
    while (records !== null) {
      yield records;
      records = after === undefined ? null : await reportedPageRead(api.knex.instance, name, page);
    }
  }

  return Object.freeze({
    queryAll,
    queryPages
  });
}

export { createEveryRowReads };
