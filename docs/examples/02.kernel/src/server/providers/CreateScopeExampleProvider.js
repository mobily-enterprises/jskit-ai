const CART = "docs.examples.02.scoped.cart";
const CREATE_SCOPE_REPORT = "docs.examples.02.createScope.report";

class CreateScopeExampleProvider {
  static id = "docs.examples.02.createScope";

  static dependsOn = ["docs.examples.02.scoped"];

  register() {}

  boot(app) {
    const searchScope = app.createScope("search-request");
    const checkoutScope = app.createScope("checkout-request");

    const searchCart = searchScope.make(CART);
    const checkoutCart = checkoutScope.make(CART);

    searchCart.add("preview-item");
    checkoutCart.add("final-item");

    app.instance(CREATE_SCOPE_REPORT, {
      differentScopeObjects: searchScope !== checkoutScope,
      searchItems: searchCart.list(),
      checkoutItems: checkoutCart.list(),
      searchScopeId: searchCart.scopeId,
      checkoutScopeId: checkoutCart.scopeId
    });
  }
}

export { CreateScopeExampleProvider };
