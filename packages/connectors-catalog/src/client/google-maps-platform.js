/** Compose an app-owned Google map after the application has loaded Google's SDK. */
async function mountGoogleMap({ element, maps = globalThis.google?.maps, center, zoom = 12, mapId, markers = [], path = [], signal } = {}) {
  const coordinate = point => {
    if (!point || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 || !Number.isFinite(point.lng) || Math.abs(point.lng) > 180) throw new Error("Use finite lat/lng coordinates within Earth bounds.");
    return { lat: point.lat, lng: point.lng };
  };
  if (!element?.replaceChildren || typeof maps?.importLibrary !== "function") throw new Error("Provide a map container and load the Google Maps JavaScript SDK first.");
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 22) throw new Error("Use zoom between 0 and 22.");
  if (!Array.isArray(markers) || markers.length > 100 || !Array.isArray(path) || path.length > 10000) throw new Error("Use at most 100 markers and 10000 route points.");
  if (markers.length && (typeof mapId !== "string" || !mapId.trim())) throw new Error("Advanced markers require a Google JavaScript map ID.");
  const position = coordinate(center);
  const markerOptions = markers.map(marker => {
    if (marker.title !== undefined && typeof marker.title !== "string") throw new Error("Marker titles must be text.");
    return { position: coordinate(marker.position), title: marker.title || "" };
  });
  const route = path.map(coordinate);
  signal?.throwIfAborted();
  const library = await maps.importLibrary("maps");
  const markerLibrary = markerOptions.length ? await maps.importLibrary("marker") : null;
  signal?.throwIfAborted();
  const map = new library.Map(element, { center: position, zoom, ...(mapId ? { mapId } : {}) });
  const pins = []; let line; let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", dispose);
    for (const pin of pins) { maps.event.clearInstanceListeners(pin); pin.map = null; }
    if (line) { maps.event.clearInstanceListeners(line); line.setMap(null); }
    maps.event.clearInstanceListeners(map);
    element.replaceChildren();
  }
  try {
    for (const options of markerOptions) pins.push(new markerLibrary.AdvancedMarkerElement({ ...options, map }));
    if (route.length) line = new library.Polyline({ map, path: route });
    signal?.addEventListener("abort", dispose, { once: true });
    return { map, dispose };
  } catch (error) { dispose(); throw error; }
}
export { mountGoogleMap };
