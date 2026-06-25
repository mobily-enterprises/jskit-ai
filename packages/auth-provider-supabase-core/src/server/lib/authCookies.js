function safeRequestCookies(request) {
  if (request?.cookies && typeof request.cookies === "object") {
    return request.cookies;
  }

  return {};
}

function cookieOptions(isProduction, maxAge) {
  const options = {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/"
  };

  if (Number.isFinite(maxAge)) {
    options.maxAge = Math.max(0, Math.floor(maxAge));
  }

  return options;
}

function cookieClearOptions(isProduction) {
  return [
    cookieOptions(isProduction, 0),
    {
      ...cookieOptions(isProduction, 0),
      path: "/api"
    }
  ];
}

export { safeRequestCookies, cookieOptions, cookieClearOptions };
