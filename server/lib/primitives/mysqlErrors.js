function isMysqlDuplicateEntryError(error) {
  if (!error) {
    return false;
  }

  return String(error.code || "") === "ER_DUP_ENTRY";
}

export { isMysqlDuplicateEntryError };
