const mainClientComponents = [];

function registerMainClientComponent(componentToken, resolveComponent) {
  const token = String(componentToken || "").trim();
  if (!token || typeof resolveComponent !== "function") {
    return;
  }
  mainClientComponents.push(
    Object.freeze({
      token,
      resolveComponent
    })
  );
}

class MainClientProvider {
  static id = "local.main.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("MainClientProvider requires application singleton().");
    }

    for (const entry of mainClientComponents) {
      app.singleton(entry.token, entry.resolveComponent);
    }
  }
}

export {
  MainClientProvider,
  registerMainClientComponent
};
