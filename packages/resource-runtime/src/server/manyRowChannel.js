import { AsyncLocalStorage } from "node:async_hooks";
import diagnosticsChannel from "node:diagnostics_channel";

// Each many-row call publishes { resource, operation, rows, chunkSize } here while something subscribes, and each page
// of queryPages() after its first publishes { resource, operation: "queryPages", statements }, so a flat-query test
// can tell the statements chunking and paging add from statements that grow with the rows.
const MANY_ROW_CHANNEL = "jskit:resources:many-row";
// The page read open in the current async context, whose statements it counts.
const openPageRead = new AsyncLocalStorage();

/**
 * Runs `read`, a page of queryPages() after its first, and, while a flat-query test listens, publishes how many
 * statements it sent: the page's own, its included records' and its hidden fields', not the caller's work between
 * pages.
 * @template T
 * @param {{ on: Function, off: Function }} knex The handle's Knex, which reports its transactions' statements too.
 * @param {string} resource
 * @param {() => Promise<T>} read
 * @returns {Promise<T>}
 */
async function reportedPageRead(knex, resource, read) {
  const channel = diagnosticsChannel.channel(MANY_ROW_CHANNEL);
  if (!channel.hasSubscribers) {
    return read();
  }
  const page = Symbol("page");
  let statements = 0;
  const count = () => {
    if (openPageRead.getStore() === page) statements += 1;
  };
  knex.on("query", count);
  try {
    return await openPageRead.run(page, read);
  } finally {
    knex.off("query", count);
    channel.publish(Object.freeze({
      resource,
      operation: "queryPages",
      statements
    }));
  }
}

export { MANY_ROW_CHANNEL, reportedPageRead };
