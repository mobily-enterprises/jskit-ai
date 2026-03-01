function shellQuote(value) {
  const raw = String(value ?? "");
  if (!raw) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:=+,-]+$/.test(raw)) {
    return raw;
  }
  return `'${raw.replace(/'/g, "'\\''")}'`;
}

export { shellQuote };
