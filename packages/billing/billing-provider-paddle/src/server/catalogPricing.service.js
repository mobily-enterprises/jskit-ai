function createService() {
  async function resolveCatalogCorePriceForCreate({ corePrice } = {}) {
    const normalizedCorePrice = corePrice && typeof corePrice === "object" ? corePrice : null;
    return normalizedCorePrice;
  }

  async function resolveCatalogCorePriceForUpdate({ corePrice } = {}) {
    return resolveCatalogCorePriceForCreate({ corePrice });
  }

  async function resolveCatalogProductPriceForCreate({ price } = {}) {
    return price;
  }

  async function resolveCatalogProductPriceForUpdate({ price } = {}) {
    return resolveCatalogProductPriceForCreate({ price });
  }

  return {
    resolveCatalogCorePriceForCreate,
    resolveCatalogCorePriceForUpdate,
    resolveCatalogProductPriceForCreate,
    resolveCatalogProductPriceForUpdate
  };
}

export { createService };
