import { resolveLinkPath } from "../shared/support/linkPath.js";
import { splitPathQueryAndHash } from "../shared/support/queryPath.js";

function queryStringToObject(queryString = "") {
  const normalizedQueryString = String(queryString || "").trim().replace(/^\?+/, "");
  if (!normalizedQueryString) {
    return undefined;
  }

  const params = new URLSearchParams(normalizedQueryString);
  const query = {};

  for (const [key, value] of params.entries()) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) {
      query[key] = value;
      continue;
    }

    if (Array.isArray(query[key])) {
      query[key].push(value);
      continue;
    }

    query[key] = [query[key], value];
  }

  return query;
}

function redirectToChild(childTarget = "") {
  const normalizedChildTarget = String(childTarget || "").trim();

  return function redirectToChildRoute(to = {}) {
    const resolvedTarget = resolveLinkPath(String(to?.path || "/"), normalizedChildTarget);
    const { pathname, queryString, hash } = splitPathQueryAndHash(resolvedTarget);

    return {
      path: pathname || "/",
      query: queryStringToObject(queryString) ?? to?.query,
      hash: hash || String(to?.hash || "")
    };
  };
}

export { redirectToChild };
