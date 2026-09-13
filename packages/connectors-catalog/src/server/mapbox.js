import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { mapboxDefinition } from "../shared/mapbox.js";
import { jsonOperation } from "./jsonOperation.js";

const directionsSchema = createSchema({
  profile: { type: "string", enum: ["driving", "driving-traffic", "walking", "cycling"], defaultTo: "driving" },
  coordinates: { type: "array", required: true, validator: points => points.length >= 2 && points.length <= 25 || "Use 2–25 waypoints.",
    items: { type: "object", schema: createSchema({ longitude: { type: "number", required: true, min: -180, max: 180 }, latitude: { type: "number", required: true, min: -90, max: 90 } }) } },
  steps: { type: "boolean", defaultTo: false }
});
const geocodingResult = (result) => result?.type === "FeatureCollection" && Array.isArray(result.features) && typeof result.attribution === "string";
const mapboxProvider = Object.freeze({
  ...mapboxDefinition,
  apiOrigins: ["https://api.mapbox.com"],
  apiKey: { queryParameter: "access_token" },
  checkOperation: "token.read",
  operations: {
    "directions.get": { scopes: [], request(input) {
      const { profile, coordinates, steps } = validateSchemaPayload({ schema: directionsSchema, mode: "replace" }, input, { statusCode: 422 });
      const points = coordinates.map(point => `${point.longitude},${point.latitude}`).join(";");
      return { method: "GET", url: `https://api.mapbox.com/directions/v5/mapbox/${profile}/${points}?geometries=geojson&overview=full&steps=${steps}` };
    }, validateResult: result => ["NoRoute", "NoSegment"].includes(result?.code) || result?.code === "Ok" && Array.isArray(result.routes) && result.routes.every(route =>
      Number.isFinite(route.distance) && route.distance >= 0 && Number.isFinite(route.duration) && route.duration >= 0 && route.geometry?.type === "LineString" && Array.isArray(route.geometry.coordinates)) },
    "token.read": jsonOperation("https://api.mapbox.com/tokens/v2", {}, (result) => {
      if (["TokenMalformed", "TokenInvalid", "TokenExpired", "TokenRevoked"].includes(result?.code)) {
        throw new ConnectorError("connector_reconnect_required", "Configure a valid Mapbox token and connect again.", { statusCode: 401 });
      }
      return result?.code === "TokenValid" && ["pk", "sk", "tk"].includes(result.token?.usage) && typeof result.token.user === "string";
    }),
    "geocoding.forward": jsonOperation("https://api.mapbox.com/search/geocode/v6/forward", {
      q: { type: "string", required: true, minLength: 1, maxLength: 256,
        validator: (value) => !value.includes(";") && (value.match(/[\p{L}\p{N}]+/gu) || []).length <= 20 || "Use at most 20 words or numbers and no semicolons." },
      limit: { type: "integer", min: 1, max: 10, defaultTo: 5 },
      autocomplete: { type: "boolean", defaultTo: false },
      permanent: { type: "boolean", defaultTo: false }
    }, geocodingResult),
    "geocoding.reverse": jsonOperation("https://api.mapbox.com/search/geocode/v6/reverse", {
      longitude: { type: "number", required: true, min: -180, max: 180 },
      latitude: { type: "number", required: true, min: -90, max: 90 },
      permanent: { type: "boolean", defaultTo: false }
    }, geocodingResult)
  }
});
export { mapboxProvider };
