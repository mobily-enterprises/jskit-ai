function parseUploadResponse(xhr) {
  if (!xhr?.responseText) {
    return {};
  }

  try {
    return JSON.parse(xhr.responseText);
  } catch {
    return {};
  }
}

export { parseUploadResponse };
