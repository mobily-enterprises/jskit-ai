import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { googleMapsPlatformDefinition } from "../shared/google-maps-platform.js";
import { jsonOperation } from "./jsonOperation.js";

const endpoint = "https://maps.googleapis.com/maps/api/geocode/json";
const language = { type: "string", minLength: 2, maxLength: 35,
  validator: (value) => /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value) || "Use a language code such as en or pt-BR." };
const reverseSchema = createSchema({
  latitude: { type: "number", required: true, min: -90, max: 90 },
  longitude: { type: "number", required: true, min: -180, max: 180 },
  language
});

function validateGeocoding(result) {
  switch (result?.status) {
    case "OVER_QUERY_LIMIT":
      throw new ConnectorError("connector_rate_limited", "The Google Maps request quota was reached.", { statusCode: 429 });
    case "OVER_DAILY_LIMIT":
      throw new ConnectorError("connector_configuration_invalid", "Check the Google Maps server key, billing and usage cap.");
    case "REQUEST_DENIED":
      throw new ConnectorError("connector_permission_denied", "Google Maps denied access. Check the enabled API and key restrictions.", { statusCode: 403 });
    case "INVALID_REQUEST":
      throw new ConnectorError("connector_input_invalid", "Google Maps could not accept this geocoding request.", { statusCode: 422 });
    case "UNKNOWN_ERROR":
      throw new ConnectorError("connector_provider_failed", "Google Maps could not process the request. Try again.", { statusCode: 502 });
    case "ZERO_RESULTS":
      return Array.isArray(result.results) && result.results.length === 0;
    case "OK":
      return Array.isArray(result.results) && result.results.length > 0 && result.results.every((place) =>
        typeof place?.formatted_address === "string" && typeof place.place_id === "string" &&
        Number.isFinite(place.geometry?.location?.lat) && Math.abs(place.geometry.location.lat) <= 90 &&
        Number.isFinite(place.geometry.location.lng) && Math.abs(place.geometry.location.lng) <= 180);
    default:
      return false;
  }
}

function mapsOperation(fields, request, validateResult) {
  const schema = createSchema(fields);
  return { scopes: [], validateResult, request(input) { return request(validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 })); } };
}
const latitude = { type: "number", required: true, min: -90, max: 90 };
const longitude = { type: "number", required: true, min: -180, max: 180 };
const placeFields = "id,displayName,formattedAddress,location,attributions,googleMapsUri";
const googleMapsPlatformProvider = Object.freeze({
  ...googleMapsPlatformDefinition,
  apiOrigins: ["https://maps.googleapis.com", "https://places.googleapis.com", "https://routes.googleapis.com"],
  apiKey: { queryParameter: "key" },
  checkOperation: "geocoding.forward",
  exchange(address, options, { request, apiKey }) {
    const target = new URL(address);
    if (target.hostname === "maps.googleapis.com") return request(address, options);
    target.searchParams.delete("key");
    return request(target.href, { ...options, headers: { ...options.headers, "X-Goog-Api-Key": apiKey } });
  },
  operations: {
    "places.search": mapsOperation({ textQuery: { type: "string", required: true, minLength: 1, maxLength: 1000 }, pageSize: { type: "integer", min: 1, max: 20, defaultTo: 10 }, pageToken: { type: "string", minLength: 1, maxLength: 4096 }, languageCode: language }, body => ({ method: "POST", url: "https://places.googleapis.com/v1/places:searchText", headers: { "X-Goog-FieldMask": placeFields.split(",").map(field => `places.${field}`).join(",") + ",nextPageToken" }, body }),
      result => Boolean(result && typeof result === "object" && !Array.isArray(result) && !result.error && (result.places === undefined || Array.isArray(result.places) && result.places.every(place => typeof place?.id === "string")))),
    "places.get": mapsOperation({ placeId: { type: "string", required: true, minLength: 1, maxLength: 512, validator: value => /^[A-Za-z0-9_-]+$/.test(value) || "Use a place ID, not a URL." } }, ({ placeId }) => ({ method: "GET", url: `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, headers: { "X-Goog-FieldMask": placeFields } }), result => typeof result?.id === "string"),
    "routes.compute": mapsOperation({ originLatitude: latitude, originLongitude: longitude, destinationLatitude: latitude, destinationLongitude: longitude,
      travelMode: { type: "string", enum: ["DRIVE", "WALK", "BICYCLE"], defaultTo: "DRIVE" }
    }, ({ originLatitude, originLongitude, destinationLatitude, destinationLongitude, travelMode }) => ({ method: "POST", url: "https://routes.googleapis.com/directions/v2:computeRoutes", headers: { "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring" }, body: {
      origin: { location: { latLng: { latitude: originLatitude, longitude: originLongitude } } },
      destination: { location: { latLng: { latitude: destinationLatitude, longitude: destinationLongitude } } },
      travelMode, polylineEncoding: "GEO_JSON_LINESTRING"
    } }), result => Boolean(result && typeof result === "object" && !Array.isArray(result) && !result.error && (result.routes === undefined || Array.isArray(result.routes)))),
    "geocoding.forward": jsonOperation(endpoint, {
      address: { type: "string", required: true, minLength: 1, maxLength: 1000,
        validator: (value) => Boolean(value.trim()) || "Enter an address or plus code." },
      language,
      region: { type: "string", minLength: 2, maxLength: 2,
        validator: (value) => /^[a-z]{2}$/i.test(value) || "Use a two-letter region code." }
    }, validateGeocoding),
    "geocoding.reverse": {
      scopes: [],
      request(input) {
        const values = validateSchemaPayload({ schema: reverseSchema, mode: "replace" }, input, { statusCode: 422 });
        const url = new URL(endpoint);
        url.searchParams.set("latlng", `${values.latitude},${values.longitude}`);
        if (values.language !== undefined) url.searchParams.set("language", values.language);
        return { method: "GET", url: url.href };
      },
      validateResult: validateGeocoding
    }
  }
});

export { googleMapsPlatformProvider };
