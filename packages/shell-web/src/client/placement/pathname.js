function resolveRuntimePathname(candidate = "") {
  const explicitPathname = String(candidate || "").trim();
  if (explicitPathname) {
    return explicitPathname;
  }

  if (typeof window === "object" && window?.location?.pathname) {
    return String(window.location.pathname || "").trim() || "/";
  }

  return "/";
}

export { resolveRuntimePathname };
