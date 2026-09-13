// Application-owned composition: service.authorize must approve this exact key
// for context. The same function works in a Node CLI or application backend.
// Pass a bounded signal for both signing and the complete response-body read.
export async function transferS3Object({ service, context, integrationId, key,
  direction, body, signal, fetchImpl = globalThis.fetch }) {
  if (!["download", "upload"].includes(direction)) throw new TypeError("Choose download or upload.");
  if (!signal) throw new TypeError("Supply a transfer cancellation/timeout signal.");
  if (direction === "upload" && !(body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body))) {
    throw new TypeError("Supply a Blob, ArrayBuffer or typed-array upload body.");
  }
  signal.throwIfAborted();
  const signed = await service.invoke({ context, integrationId, signal,
    operation: direction === "upload" ? "objects.uploadUrl" : "objects.downloadUrl",
    input: { key } });
  let response;
  try {
    response = await fetchImpl(signed.url, { method: signed.method,
      ...(direction === "upload" ? { body } : {}), signal,
      credentials: "omit", redirect: "error" });
  } catch {
    // Do not expose the URL through a network error/cause or retry a PUT whose
    // outcome is unknown. The app decides whether to inspect and retry later.
    throw new Error(direction === "upload"
      ? "Upload interrupted; completion is unknown. Check the object before retrying."
      : "Download interrupted. Request a fresh download when ready.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`S3 ${direction} failed (HTTP ${response.status}). Check permissions and URL expiry.`);
  }
  // Keep binary downloads as a stream; the caller must await its consumption
  // before announcing completion. Upload success means S3 acknowledged the PUT.
  return response;
}
