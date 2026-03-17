function splitPathAndHash(path = "") {
  const normalizedPath = String(path || "").trim();
  const hashIndex = normalizedPath.indexOf("#");
  if (hashIndex < 0) {
    return {
      pathWithoutHash: normalizedPath,
      hash: ""
    };
  }

  return {
    pathWithoutHash: normalizedPath.slice(0, hashIndex),
    hash: normalizedPath.slice(hashIndex)
  };
}

function appendQueryString(path = "", queryString = "") {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    return "";
  }

  const normalizedQuery = String(queryString || "").trim().replace(/^\?+/, "");
  if (!normalizedQuery) {
    return normalizedPath;
  }

  const { pathWithoutHash, hash } = splitPathAndHash(normalizedPath);
  const separator = pathWithoutHash.includes("?") ? "&" : "?";
  return `${pathWithoutHash}${separator}${normalizedQuery}${hash}`;
}

export { appendQueryString };
