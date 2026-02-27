function isDuplicateEntryError(error) {
  if (!error) {
    return false;
  }

  const code = String(error.code || "").trim().toUpperCase();
  if (code === "ER_DUP_ENTRY") {
    return true;
  }

  const errno = Number(error.errno || error.errorno || 0);
  return errno === 1062;
}

export { isDuplicateEntryError };
