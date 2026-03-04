const CART = "docs.examples.02.scoped.cart";

class ScopedExampleProvider {
  static id = "docs.examples.02.scoped";

  register(app) {
    app.scoped(CART, (scope) => {
      const items = [];
      return {
        scopeId: scope?.scopeId || "unknown",
        add(item) {
          items.push(item);
        },
        list() {
          return [...items];
        }
      };
    });
  }

  boot(app) {
    // Create a scope for checkout flow state.
    const checkoutScope = app.createScope("checkout-request");
    // Create a separate scope for profile flow state.
    const profileScope = app.createScope("profile-request");

    // First resolve in checkout scope.
    const checkoutCartA = checkoutScope.make(CART);
    // Second resolve in the same scope; should be the same instance as checkoutCartA.
    const checkoutCartB = checkoutScope.make(CART);
    // Resolve in a different scope; should be a different instance.
    const profileCart = profileScope.make(CART);

    // Add one item to checkout scope state.
    checkoutCartA.add("keyboard");
    // Add one item to profile scope state.
    profileCart.add("mouse");

    // Example: true (same scope returns same scoped instance)
    const sameWithinScope = checkoutCartA === checkoutCartB;
    // Example: true (different scopes return different scoped instances)
    const differentAcrossScopes = checkoutCartA !== profileCart;
    // Example: ["keyboard"]
    const checkoutItems = checkoutCartB.list();
    // Example: ["mouse"]
    const profileItems = profileCart.list();
    // Example: "checkout-request"
    const checkoutScopeId = checkoutCartA.scopeId;
    // Example: "profile-request"
    const profileScopeId = profileCart.scopeId;

    if (
      !sameWithinScope ||
      !differentAcrossScopes ||
      checkoutItems.length !== 1 ||
      checkoutItems[0] !== "keyboard" ||
      profileItems.length !== 1 ||
      profileItems[0] !== "mouse" ||
      checkoutScopeId !== "checkout-request" ||
      profileScopeId !== "profile-request"
    ) {
      throw new Error("ScopedExampleProvider expected scoped() scope-local sharing and cross-scope isolation.");
    }
  }
}

export { ScopedExampleProvider };
