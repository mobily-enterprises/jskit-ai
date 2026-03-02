function createRepoTransaction(dbClient) {
  return async function repoTransaction(callback) {
    if (typeof dbClient?.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  };
}

export { createRepoTransaction };
