function safeRequestCookies(request) {
  if (request?.cookies && typeof request.cookies === "object") {
    return request.cookies;
  }

  return {};
}

function cookieOptions(isStagingOrProduction, maxAge) {
  const options = {
    httpOnly: true,
    sameSite: "lax",
    secure: isStagingOrProduction,
    path: "/"
  };

  if (Number.isFinite(maxAge)) {
    options.maxAge = Math.max(0, Math.floor(maxAge));
  }

  return options;
}

function cookieClearOptions(isStagingOrProduction) {
  return [
    cookieOptions(isStagingOrProduction, 0),
    {
      ...cookieOptions(isStagingOrProduction, 0),
      path: "/api"
    }
  ];
}

export { safeRequestCookies, cookieOptions, cookieClearOptions };
