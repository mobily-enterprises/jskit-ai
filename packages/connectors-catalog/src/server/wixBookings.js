import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { serializeNativeJson, requestPath, sameRecord, cursor, querySchema, contactIdField, nativeJsonObjectField } from "./wixValues.js";
import { isUuid } from "./connectorValues.js";

// Wix Bookings operations: bookings, services, availability, staff, categories and service forms.

function bookingDirectoryOperation(kind) {
  const staff = kind === "staff";
  return {
    scopes: [],
    request(input) {
      const cursorPaging = validateSchemaPayload({ schema: querySchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: staff ? "https://www.wixapis.com/bookings/v1/staff-members/query" : "https://www.wixapis.com/bookings/v2/categories/query",
        body: {
          query: { cursorPaging, sort: [{ fieldName: "id", order: "ASC" }], ...(staff ? { filter: { serviceProvider: true } } : {}) },
          ...(staff ? { fields: ["RESOURCE_DETAILS"] } : {})
        } };
    },
    validateResult(value) {
      const values = staff ? value?.staffMembers : value?.categories;
      const paging = value?.pagingMetadata;
      return Array.isArray(values) && values.length <= 100 && values.every(item => isUuid(item?.id) && typeof item.name === "string" &&
        (!staff || isUuid(item.resourceId))) && (paging === undefined || paging && typeof paging === "object" && !Array.isArray(paging) &&
          (paging.hasNext === undefined || typeof paging.hasNext === "boolean") &&
          (paging.cursors === undefined || paging.cursors && typeof paging.cursors === "object" && !Array.isArray(paging.cursors) &&
            ["next", "prev"].every(key => paging.cursors[key] === undefined || cursor(paging.cursors[key]))));
    }
  };
}
const servicePagingSchema = createSchema({ limit: { type: "integer", min: 1, max: 100, defaultTo: 20 }, offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 } });
const serviceIdSchema = createSchema({ serviceId: contactIdField });
const serviceUpdateSchema = createSchema({
  serviceId: contactIdField,
  revision: { type: "none", required: true, validator: value => typeof value === "string" && /^\d{1,19}$/u.test(value) && BigInt(value) <= 9223372036854775807n || "Use the returned service revision string." },
  name: { type: "string", minLength: 1, maxLength: 400 }, description: { type: "string", maxLength: 7000 }, tagLine: { type: "string", maxLength: 6000 },
  payment: nativeJsonObjectField,
  onlineBooking: { type: "object", schema: createSchema({ enabled: { type: "boolean" }, requireManualApproval: { type: "boolean" }, allowMultipleRequests: { type: "boolean" } }) },
  defaultCapacity: { type: "integer", min: 1, max: 1000 },
  staffMemberIds: { type: "array", validator: values => values.length > 0 && values.length <= 100 || "Select 1–100 staff resource IDs.", items: { type: "string", validator: value => isUuid(value) || "Use a staff resource ID." } },
  schedule: { type: "object", schema: createSchema({ availabilityConstraints: { type: "object", required: true, schema: createSchema({
    sessionDurations: { type: "array", validator: values => values.length > 0 && values.length <= 50 || "Use 1–50 appointment durations.", items: { type: "integer", min: 1 } },
    timeBetweenSessions: { type: "integer", min: 0 }
  }) } }) }
});
const validService = value => isUuid(value?.id) && typeof value.name === "string" && typeof value.revision === "string" && /^\d{1,19}$/u.test(value.revision) &&
  ["APPOINTMENT", "CLASS", "COURSE"].includes(value.type);
const localDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(value) &&
  Number.isFinite(Date.parse(`${value}Z`)) && new Date(`${value}Z`).toISOString().slice(0, 19) === value;
const validSlot = value => isUuid(value?.serviceId) && localDate(value.localStartDate) && localDate(value.localEndDate) &&
  value.localStartDate < value.localEndDate && typeof value.bookable === "boolean";
const availabilityLocationSchema = createSchema({
  id: { type: "string", validator: value => isUuid(value) || "Use the Wix business location ID." },
  locationType: { type: "string", required: true, enum: ["BUSINESS", "CUSTOM", "CUSTOMER"] },
  name: { type: "string", maxLength: 1000 }, formattedAddress: { type: "string", maxLength: 4000 }
});
// Availability must answer for the requested service, local time window and time zone.
function requestedAvailability(value, requested, events) {
  const slots = value.timeSlots ?? [value.timeSlot];
  sameRecord(!(requested.timeZone && value.timeZone !== requested.timeZone || slots.some(slot => requested.serviceId && slot.serviceId !== requested.serviceId ||
    requested.localStartDate && (slot.localStartDate !== requested.localStartDate || slot.localEndDate !== requested.localEndDate))),
  "Wix returned availability for a different service, time or time zone.", { messageCode: "connectors.wix.returnedAvailabilityDifferentServiceTime" });
  return !events || !requested.serviceIds || sameRecord(slots.every(slot => requested.serviceIds.includes(slot.serviceId)), "Wix returned a class slot for a different service.", { messageCode: "connectors.wix.returnedClassSlotDifferentService" });
}
function availabilityOperation(action, events = false) {
  const schema = createSchema({
    ...(!events ? {
      customerChoices: { type: "object", schema: createSchema({
        durationInMinutes: { type: "integer", min: 1, max: 57600 },
        addOnIds: { type: "array", validator: values => values.length > 0 && values.length <= 21 && new Set(values).size === values.length || "Select 1–21 distinct add-ons.",
          items: { type: "string", validator: value => isUuid(value) || "Use the add-on ID returned by Wix." } }
      }) },
      includeResourceTypeIds: { type: "array", validator: values => values.length <= 100 || "Choose at most 100 resource types.", items: { type: "string", validator: value => isUuid(value) || "Use a resource type ID." } },
      ...(action === "list" ? { locations: { type: "array", validator: values => values.length <= 5 || "Choose at most five locations.", items: { type: "object", schema: availabilityLocationSchema } } } : {
        location: { type: "object", schema: availabilityLocationSchema },
        resourceTypes: { type: "array", validator: values => values.length <= 8 || "Choose at most eight resource types.", items: { type: "object", schema: createSchema({
          resourceTypeId: { type: "string", required: true, validator: value => isUuid(value) || "Use a resource type ID." },
          resourceIds: { type: "array", required: true, validator: values => values.length > 0 && values.length <= 135 || "Choose 1–135 resource IDs.", items: { type: "string", validator: value => isUuid(value) || "Use a resource ID." } }
        }) } }
      })
    } : {}),
    ...(events ? { minBookableCapacity: { type: "integer", min: 1, max: 1000 } } : {}),
    serviceId: { type: "string", validator: value => isUuid(value) || "Use the appointment service ID." },
    ...(action === "list" ? {
      fromLocalDate: { type: "string", validator: value => localDate(value) || "Use YYYY-MM-DDThh:mm:ss without an offset." },
      toLocalDate: { type: "string", validator: value => localDate(value) || "Use YYYY-MM-DDThh:mm:ss without an offset." },
      limit: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
      cursor: { type: "string", validator: value => cursor(value) || "Use the returned page cursor." }
    } : {
      localStartDate: { type: "string", required: true, validator: value => localDate(value) || "Use the returned local start date." },
      localEndDate: { type: "string", required: true, validator: value => localDate(value) || "Use the returned local end date." }
    }),
    timeZone: { type: "string", maxLength: events ? 100 : 150, validator: value => {
      try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return "Use an IANA time zone."; }
    } }
  });
  return {
    scopes: [],
    request(input) {
      const { limit, cursor: next, ...body } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (next && Object.keys(body).length) throw new ConnectorError("connector_input_invalid", "Use only cursor and limit for the next availability page.", { statusCode: 422, messageCode: "connectors.wix.useCursorLimitNextAvailability" });
      if (body.customerChoices && !Object.keys(body.customerChoices).length) throw new ConnectorError("connector_input_invalid", "Select a duration or add-ons before supplying customer choices.", { statusCode: 422, messageCode: "connectors.wix.selectDurationAddOnsSupplying" });
      if (!next && (!body.serviceId || !body.timeZone || (action === "list" ? !body.fromLocalDate || !body.toLocalDate || body.fromLocalDate >= body.toLocalDate : body.localStartDate >= body.localEndDate))) {
        throw new ConnectorError("connector_input_invalid", "Choose the service, time zone and an increasing local date range.", { statusCode: 422, messageCode: "connectors.wix.chooseServiceTimeZoneIncreasing" });
      }
      const locations = body.locations ?? (body.location ? [body.location] : []);
      if (locations.some(location => location.locationType === "BUSINESS" && !location.id)) throw new ConnectorError("connector_input_invalid", "Choose the business location ID.", { statusCode: 422, messageCode: "connectors.wix.chooseBusinessLocationId" });
      const { serviceId, ...eventBody } = body;
      return { method: "POST", url: `https://www.wixapis.com/_api/service-availability/v2/time-slots${events ? "/event" : action === "get" ? "/get" : ""}`,
        body: action === "get" ? body : next ? { cursorPaging: { limit, cursor: next } } : { ...(events ? { ...eventBody, serviceIds: [serviceId], includeNonBookable: false } : { ...body, bookable: true }), cursorPaging: { limit } } };
    },
    validateResult: (value, request) => typeof value?.timeZone === "string" && (action === "get" ? validSlot(value.timeSlot) :
      Array.isArray(value.timeSlots) && value.timeSlots.length <= 1000 && value.timeSlots.every(slot => validSlot(slot) && (!events || typeof slot.eventInfo?.eventId === "string" && slot.eventInfo.eventId.length >= 36 && slot.eventInfo.eventId.length <= 250)) &&
      (value[events ? "pagingMetadata" : "cursorPagingMetadata"] === undefined || value[events ? "pagingMetadata" : "cursorPagingMetadata"] && typeof value[events ? "pagingMetadata" : "cursorPagingMetadata"] === "object" && !Array.isArray(value[events ? "pagingMetadata" : "cursorPagingMetadata"]) &&
        (value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors === undefined || value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors && typeof value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors === "object" && !Array.isArray(value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors) &&
          ["next", "prev"].every(key => value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors[key] === undefined || cursor(value[events ? "pagingMetadata" : "cursorPagingMetadata"].cursors[key]))))) &&
      requestedAvailability(value, request.body, events)
  };
}
const eventSlotSchema = createSchema({
  eventId: { type: "string", required: true, minLength: 36, maxLength: 250, validator: value => !/[\p{Cc}]/u.test(value) || "Use the returned event ID." },
  timeZone: { type: "string", required: true, maxLength: 100, validator: value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return "Use an IANA time zone."; }
  } }
});
const serviceLocationSchema = createSchema({
  type: { type: "string", required: true, enum: ["BUSINESS", "CUSTOM", "CUSTOMER"] },
  business: { type: "object", schema: createSchema({ id: contactIdField }) },
  custom: { type: "object", schema: createSchema({ address: { ...nativeJsonObjectField, required: true } }) }
});
const setServiceLocationsSchema = createSchema({
  serviceId: contactIdField,
  locations: { type: "array", required: true, validator: values => values.length <= 100 || "Use at most 100 locations.", items: { type: "object", schema: serviceLocationSchema } },
  removedLocationAction: { type: "string", required: true, enum: ["KEEP_AT_CURRENT_LOCATION", "MOVE_TO_LOCATION"] },
  moveToLocation: { type: "object", schema: serviceLocationSchema },
  notifyParticipants: { type: "boolean", defaultTo: false }, notificationMessage: { type: "string", maxLength: 2000 }
});
const serviceCreateSchema = createSchema({ service: { ...nativeJsonObjectField, required: true } });
const formSummarySchema = createSchema({ formId: { type: "string", required: true, validator: value => isUuid(value) || "Use the service form ID." } });
const bookingCreateSchema = createSchema({
  serviceId: { type: "string", required: true, validator: value => isUuid(value) || "Use the Wix service ID." },
  kind: { type: "string", required: true, enum: ["APPOINTMENT", "CLASS", "COURSE"] },
  timeZone: { type: "string", required: true, maxLength: 150, validator: value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return "Use an IANA time zone."; }
  } },
  startDate: { type: "string", validator: value => localDate(value) || "Use the selected slot's local start date." },
  endDate: { type: "string", validator: value => localDate(value) || "Use the selected slot's local end date." },
  eventId: { type: "string", minLength: 36, maxLength: 250, validator: value => !/[\p{Cc}]/u.test(value) || "Use the returned event ID." },
  scheduleId: { type: "string", validator: value => isUuid(value) || "Use the course schedule ID." },
  resourceId: { type: "string", validator: value => isUuid(value) || "Use the selected resource ID." },
  location: { type: "object", schema: createSchema({
    id: { type: "string", validator: value => isUuid(value) || "Use the business location ID." },
    locationType: { type: "string", required: true, enum: ["OWNER_BUSINESS", "OWNER_CUSTOM", "CUSTOM"] },
    name: { type: "string", maxLength: 1000 }, formattedAddress: { type: "string", maxLength: 4000 }
  }) },
  totalParticipants: { type: "integer", min: 1, max: 1000 },
  participantsChoices: { type: "object", schema: createSchema({
    serviceChoices: { type: "array", required: true, validator: values => values.length > 0 && values.length <= 20 || "Use 1–20 participant groups.",
      items: { type: "object", schema: createSchema({
        numberOfParticipants: { type: "integer", required: true, min: 1, max: 1000 },
        choices: { type: "array", required: true, validator: values => values.length > 0 && values.length <= 5 || "Use 1–5 service choices per group.",
          items: { type: "object", schema: createSchema({
            optionId: { type: "string", required: true, validator: value => isUuid(value) || "Use the option ID returned by Wix." },
            custom: { type: "string", minLength: 1, maxLength: 1000 },
            duration: { type: "object", schema: createSchema({ minutes: { type: "integer", required: true, min: 1, max: 44639 }, name: { type: "string", maxLength: 255 } }) }
          }) } }
      }) } }
  }) },
  bookedAddOns: { type: "array", validator: values => values.length > 0 && values.length <= 21 && new Set(values.map(value => value?.id)).size === values.length || "Select 1–21 distinct add-ons.",
    items: { type: "object", schema: createSchema({
      id: { type: "string", required: true, validator: value => isUuid(value) || "Use the add-on ID returned by Wix." },
      groupId: { type: "string", validator: value => isUuid(value) || "Use the add-on group ID." },
      quantity: { type: "integer", min: 1, max: 1000 }
    }) } },
  formSubmission: { type: "none", required: true, validator: value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "Provide the booking form's field-value object.";
    try {
      const json = serializeNativeJson(value);
      return Buffer.byteLength(json) <= 100000 || "Keep booking form data within 100KB.";
    } catch { return "Use serializable JSON booking form data."; }
  } },
  notifyParticipants: { type: "boolean", defaultTo: false }, sendSmsReminder: { type: "boolean", defaultTo: false }
});
const bookingQuerySchema = createSchema({
  bookingId: { type: "string", validator: value => isUuid(value) || "Use the Wix booking ID." },
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  offset: { type: "integer", min: 0, max: 100000, defaultTo: 0 }
});
const bookingCancelSchema = createSchema({
  bookingId: { type: "string", required: true, validator: value => isUuid(value) || "Use the Wix booking ID." },
  revision: { type: "none", required: true, validator: value => typeof value === "string" && /^\d{1,19}$/u.test(value) && BigInt(value) <= 9223372036854775807n || "Use the current booking revision string." },
  notifyParticipants: { type: "boolean", defaultTo: false },
  message: { type: "string", maxLength: 2000 },
  waiveCharges: { type: "boolean", defaultTo: false }
});
const bookingRescheduleSchema = createSchema({
  bookingId: { type: "string", required: true, validator: value => isUuid(value) || "Use the Wix booking ID." },
  revision: { type: "none", required: true, validator: value => typeof value === "string" && /^\d{1,19}$/u.test(value) && BigInt(value) <= 9223372036854775807n || "Use the current booking revision string." },
  slot: { ...nativeJsonObjectField, required: true },
  notifyParticipants: { type: "boolean", defaultTo: false }, message: { type: "string", maxLength: 2000 }
});
function bookingConfirmationOperation(action) {
  const automatic = action === "confirmOrDecline";
  const schema = createSchema({
    bookingId: { type: "string", required: true, validator: value => isUuid(value) || "Use the Wix booking ID." },
    ...(automatic ? {
      paymentStatus: { type: "string", required: true, enum: ["UNDEFINED", "NOT_PAID", "PAID", "PARTIALLY_PAID", "REFUNDED", "EXEMPT"] }
    } : {
      revision: { type: "none", required: true, validator: value => typeof value === "string" && /^\d{1,19}$/u.test(value) && BigInt(value) <= 9223372036854775807n || "Use the current booking revision string." },
      notifyParticipants: { type: "boolean", defaultTo: false }, message: { type: "string", maxLength: 2000 }
    })
  });
  return {
    scopes: [],
    request(input) {
      const { bookingId, paymentStatus, revision, notifyParticipants, message } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (message !== undefined && !notifyParticipants) throw new ConnectorError("connector_input_invalid", "Enable participant notification before supplying a message.", { statusCode: 422, messageCode: "connectors.wix.enableParticipantNotificationSupplyingMessage" });
      return { method: "POST", url: automatic ? `https://www.wixapis.com/bookings/v2/confirmation/${bookingId}:confirmOrDecline` :
        `https://www.wixapis.com/_api/bookings-service/v2/bookings/${bookingId}/${action}`,
        body: automatic ? { paymentStatus } : { revision, participantNotification: { notifyParticipants, ...(message === undefined ? {} : { message }) } } };
    },
    validateResult: (value, request) => isUuid(value?.booking?.id) &&
      sameRecord(value.booking.id === (automatic ? requestPath(request, -1).split(":")[0] : requestPath(request, -2)), "Wix returned a different booking. Check the operation outcome before retrying.", { messageCode: "connectors.wix.returnedDifferentBookingCheckOperation" }) &&
      typeof value.booking.revision === "string" && /^\d{1,19}$/u.test(value.booking.revision) &&
      BigInt(value.booking.revision) <= 9223372036854775807n && (automatic ? ["CONFIRMED", "PENDING", "DECLINED"].includes(value.booking.status) : value.booking.status === (action === "confirm" ? "CONFIRMED" : "DECLINED"))
  };
}
const wixBookingOperations = {
  "bookings.reschedule": {
    scopes: [],
    request(input) {
      const { bookingId, revision, slot, notifyParticipants, message } = validateSchemaPayload({ schema: bookingRescheduleSchema, mode: "replace" }, input, { statusCode: 422 });
      if (message !== undefined && !notifyParticipants) throw new ConnectorError("connector_input_invalid", "Enable participant notification before supplying a message.", { statusCode: 422, messageCode: "connectors.wix.enableParticipantNotificationSupplyingMessage" });
      if (slot.eventId !== undefined) {
        if (Object.keys(slot).length !== 1 || typeof slot.eventId !== "string" || slot.eventId.length < 36 || slot.eventId.length > 250 || /[\p{Cc}]/u.test(slot.eventId)) {
          throw new ConnectorError("connector_input_invalid", "For a class, supply only the selected eventId in slot.", { statusCode: 422, messageCode: "connectors.wix.classSupplySelectedEventidSlot" });
        }
      } else {
        let validTimeZone = false;
        try { validTimeZone = typeof slot.timezone === "string" && !!new Intl.DateTimeFormat("en", { timeZone: slot.timezone }); } catch {}
        if (!isUuid(slot.serviceId) || !isUuid(slot.scheduleId) || !localDate(slot.startDate) || !localDate(slot.endDate) || slot.startDate >= slot.endDate || !validTimeZone) {
          throw new ConnectorError("connector_input_invalid", "For an appointment, supply its service/schedule IDs, increasing local slot dates and IANA timezone. Courses cannot be rescheduled.", { statusCode: 422, messageCode: "connectors.wix.appointmentSupplyServiceScheduleIds" });
        }
      }
      return { method: "POST", url: `https://www.wixapis.com/_api/bookings-service/v2/bookings/${bookingId}/reschedule`,
        body: { revision, slot, participantNotification: { notifyParticipants, ...(message === undefined ? {} : { message }) } } };
    },
    validateResult: (value, request) => isUuid(value?.booking?.id) && sameRecord(value.booking.id === requestPath(request, -2), "Wix returned a different booking. Check the operation outcome before retrying.", { messageCode: "connectors.wix.returnedDifferentBookingCheckOperation" }) && typeof value.booking.revision === "string" && /^\d{1,19}$/u.test(value.booking.revision) &&
      BigInt(value.booking.revision) <= 9223372036854775807n && typeof value.booking.status === "string" && value.booking.status.length > 0
  },
  "bookings.confirm": bookingConfirmationOperation("confirm"),
  "bookings.decline": bookingConfirmationOperation("decline"),
  "bookings.confirmOrDecline": bookingConfirmationOperation("confirmOrDecline"),
  "bookingServices.listAddOnGroups": {
    scopes: [],
    request(input) {
      const value = validateSchemaPayload({ schema: serviceIdSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: "https://www.wixapis.com/_api/bookings/v2/services/add-on-groups/list-add-on-groups-by-service-id",
        body: value };
    },
    validateResult: value => Array.isArray(value?.addOnGroupsDetails) && value.addOnGroupsDetails.length <= 3 &&
      value.addOnGroupsDetails.every(group => isUuid(group?.groupId) && typeof group.groupName === "string" &&
        Number.isInteger(group.maxNumberOfAddOns) && group.maxNumberOfAddOns >= 0 &&
        Array.isArray(group.addOns) && group.addOns.length <= 7 && group.addOns.every(addOn => isUuid(addOn?.addOnId) && typeof addOn.name === "string"))
  },
  "bookingServices.getVariants": {
    scopes: [],
    request(input) {
      const { serviceId } = validateSchemaPayload({ schema: serviceIdSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "GET", url: `https://www.wixapis.com/bookings/v1/serviceOptionsAndVariants/service_id/${serviceId}` };
    },
    validateResult(value, request) {
      const variants = value?.serviceVariants;
      return isUuid(variants?.id) && isUuid(variants.serviceId) && sameRecord(variants.serviceId === requestPath(request, -1), "Wix returned variants for a different service.", { messageCode: "connectors.wix.returnedVariantsDifferentService" }) &&
        Array.isArray(variants.options?.values) && variants.options.values.every(option => isUuid(option?.id) && typeof option.type === "string") &&
        Array.isArray(variants.variants?.values) && variants.variants.values.every(variant =>
          Array.isArray(variant?.choices) && variant.choices.every(choice => isUuid(choice?.optionId)));
    }
  },
  "bookingCategories.list": bookingDirectoryOperation("categories"),
  "bookingStaff.list": bookingDirectoryOperation("staff"),
  "bookingServices.setLocations": {
    scopes: [],
    request(input) {
      const { serviceId, locations, removedLocationAction: action, moveToLocation, notifyParticipants, notificationMessage } = validateSchemaPayload({ schema: setServiceLocationsSchema, mode: "replace" }, input, { statusCode: 422 });
      if ((action === "MOVE_TO_LOCATION") !== (moveToLocation !== undefined)) throw new ConnectorError("connector_input_invalid", "Provide a destination only when moving future sessions.", { statusCode: 422, messageCode: "connectors.wix.provideDestinationMovingFutureSessions" });
      if (notificationMessage !== undefined && !notifyParticipants) throw new ConnectorError("connector_input_invalid", "Enable participant notification before supplying a message.", { statusCode: 422, messageCode: "connectors.wix.enableParticipantNotificationSupplyingMessage" });
      for (const location of [...locations, ...(moveToLocation ? [moveToLocation] : [])]) {
        if (location.type === "BUSINESS" && (!location.business || location.custom) ||
            location.type === "CUSTOM" && (!location.custom || location.business || !Object.keys(location.custom.address).length) ||
            location.type === "CUSTOMER" && (location.business || location.custom)) {
          throw new ConnectorError("connector_input_invalid", "Supply the details matching each service location type.", { statusCode: 422, messageCode: "connectors.wix.supplyDetailsMatchingServiceLocation" });
        }
      }
      return { method: "POST", url: `https://www.wixapis.com/_api/bookings/v2/services/${serviceId}/locations`, body: {
        locations, removedLocationSessionsAction: { action, ...(moveToLocation ? { moveToLocationOptions: { newLocation: moveToLocation } } : {}) },
        participantNotification: { notifyParticipants, ...(notificationMessage !== undefined ? { message: notificationMessage } : {}) }
      } };
    },
    validateResult: (value, request) => validService(value?.service) && sameRecord(value.service.id === requestPath(request, -2), "Wix returned a different booking service. Check the outcome before retrying.", { messageCode: "connectors.wix.returnedDifferentBookingServiceCheck" })
  },
  "bookingServices.create": {
    scopes: [],
    request(input) {
      const { service } = validateSchemaPayload({ schema: serviceCreateSchema, mode: "replace" }, input, { statusCode: 422 });
      const invalid = (message, codes) => { throw new ConnectorError("connector_input_invalid", message, { statusCode: 422, ...codes }); };
      if (!["APPOINTMENT", "CLASS", "COURSE"].includes(service.type) || typeof service.name !== "string" || !service.name.trim() || service.name.length > 400) invalid("Provide a service type and name of up to 400 characters.", { messageCode: "connectors.wix.provideServiceTypeNameUp" });
      if (["id", "revision", "createdByAppId", "createdDate", "updatedDate", "addOnGroups"].some(key => Object.hasOwn(service, key))) invalid("Do not send generated service identity fields or existing add-on groups when creating a service.", { messageCode: "connectors.wix.doNotSendGeneratedService" });
      if (!Number.isInteger(service.defaultCapacity) || service.defaultCapacity < 1 || service.defaultCapacity > 1000 || service.type === "APPOINTMENT" && service.defaultCapacity !== 1) invalid("Set appointment capacity to 1, or class/course capacity from 1 to 1000.", { messageCode: "connectors.wix.setAppointmentCapacity1Class" });
      const online = service.onlineBooking;
      if (!online || typeof online.enabled !== "boolean" || ["requireManualApproval", "allowMultipleRequests"].some(key => online[key] !== undefined && typeof online[key] !== "boolean")) invalid("Provide explicit online-booking settings.", { messageCode: "connectors.wix.provideExplicitOnlineBookingSettings" });
      const payment = service.payment;
      if (!payment || !["FIXED", "VARIED", "CUSTOM", "NO_FEE"].includes(payment.rateType)) invalid("Use FIXED, VARIED, CUSTOM or NO_FEE service payment settings.", { messageCode: "connectors.wix.useFixedVariedCustomNo" });
      const options = payment.options;
      if (!options || typeof options !== "object" || ["online", "inPerson", "deposit", "pricingPlan"].some(key => options[key] !== undefined && typeof options[key] !== "boolean") || !(options.online === true || options.inPerson === true)) invalid("Select in-person or online payment, including for a free service.", { messageCode: "connectors.wix.selectPersonOnlinePaymentIncluding" });
      if (online.requireManualApproval && options.pricingPlan || !online.enabled && options.online) invalid("Manual approval cannot use pricing plans; online payment requires online booking.", { messageCode: "connectors.wix.manualApprovalCannotUsePricing" });
      const priced = ["FIXED", "VARIED"].includes(payment.rateType);
      if ((options.online || options.deposit) && !priced) invalid("Online and deposit payments require fixed or varied pricing.", { messageCode: "connectors.wix.onlineDepositPaymentsRequireFixed" });
      const rate = payment.rateType === "FIXED" ? payment.fixed : payment.varied;
      const money = value => value && typeof value.value === "string" && value.value.length <= 30 && /^\d+(?:\.\d{1,2})?$/u.test(value.value) && /[1-9]/u.test(value.value) && /^[A-Z]{3}$/u.test(value.currency);
      if (priced && !money(payment.rateType === "FIXED" ? rate?.price : rate?.defaultPrice)) invalid("Provide a positive decimal price string and three-letter currency code.", { messageCode: "connectors.wix.providePositiveDecimalPriceString" });
      if (payment.rateType === "CUSTOM" && (typeof payment.custom?.description !== "string" || !payment.custom.description.length || payment.custom.description.length > 50)) invalid("Describe the custom payment in up to 50 characters.", { messageCode: "connectors.wix.describeCustomPaymentUp50" });
      if (options.deposit && (!options.online || options.inPerson || !money(rate?.deposit))) invalid("A deposit requires its amount, online payment and no in-person payment.", { messageCode: "connectors.wix.depositRequiresAmountOnlinePayment" });
      const durations = service.schedule?.availabilityConstraints?.sessionDurations;
      if (service.type === "APPOINTMENT") {
        if (!Array.isArray(service.staffMemberIds) || !service.staffMemberIds.length || !service.staffMemberIds.every(isUuid)) invalid("Select at least one staff resource ID for the appointment service.", { messageCode: "connectors.wix.selectLeastStaffResourceId" });
        if (!Array.isArray(durations) || !durations.length || !durations.every(value => Number.isInteger(value) && value > 0)) invalid("Provide appointment session durations in minutes.", { messageCode: "connectors.wix.provideAppointmentSessionDurationsMinutes" });
      } else if (durations !== undefined) invalid("Class/course session durations belong to their sessions, not service availability constraints.", { messageCode: "connectors.wix.classCourseSessionDurationsBelong" });
      return { method: "POST", url: "https://www.wixapis.com/_api/bookings/v2/services", body: { service } };
    },
    validateResult: value => validService(value?.service)
  },
  "classAvailability.list": availabilityOperation("list", true),
  "classAvailability.get": {
    scopes: [],
    request(input) {
      const { eventId, timeZone } = validateSchemaPayload({ schema: eventSlotSchema, mode: "replace" }, input, { statusCode: 422 });
      const url = new URL(`https://www.wixapis.com/_api/service-availability/v2/time-slots/event/${encodeURIComponent(eventId)}`);
      url.searchParams.set("timeZone", timeZone);
      return { method: "GET", url: url.href };
    }, validateResult: (value, request) => validSlot(value?.timeSlot) && typeof value.timeSlot.eventInfo?.eventId === "string" && typeof value.timeZone === "string" &&
      sameRecord(value.timeSlot.eventInfo.eventId === requestPath(request, -1) && value.timeZone === new URL(request.url).searchParams.get("timeZone"), "Wix returned a different event slot or time zone.", { messageCode: "connectors.wix.returnedDifferentEventSlotTime" })
  },
  "forms.summary": {
    scopes: [],
    request(input) {
      const { formId } = validateSchemaPayload({ schema: formSummarySchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "GET", url: `https://www.wixapis.com/form-schema-service/v4/forms/${formId}/summary` };
    },
    validateResult: (value, request) => isUuid(value?.formSummary?.id) && sameRecord(value.formSummary.id === requestPath(request, -2), "Wix returned a different form summary.", { messageCode: "connectors.wix.returnedDifferentFormSummary" }) &&
      Array.isArray(value.formSummary.fields) && value.formSummary.fields.length <= 500 &&
      value.formSummary.fields.every(field => isUuid(field?.id) && typeof field.target === "string" && field.target.length > 0 && field.target.length <= 200 &&
        typeof field.type === "string" && field.type.length > 0 && (field.label === undefined || typeof field.label === "string" && field.label.length <= 350) &&
        (field.deleted === undefined || typeof field.deleted === "boolean") && (field.options === undefined || Array.isArray(field.options) && field.options.length <= 400))
  },
  "bookings.create": {
    scopes: [],
    request(input) {
      const value = validateSchemaPayload({ schema: bookingCreateSchema, mode: "replace" }, input, { statusCode: 422 });
      const { kind, serviceId, timeZone, startDate, endDate, eventId, scheduleId, resourceId, location, totalParticipants, participantsChoices, bookedAddOns, formSubmission, notifyParticipants, sendSmsReminder } = value;
      if (participantsChoices) {
        if (totalParticipants !== undefined) throw new ConnectorError("connector_input_invalid", "Use participant choices or a fixed participant total, not both.", { statusCode: 422, messageCode: "connectors.wix.useParticipantChoicesFixedParticipant" });
        if (participantsChoices.serviceChoices.reduce((total, group) => total + group.numberOfParticipants, 0) > 1000 ||
            participantsChoices.serviceChoices.some(group => new Set(group.choices.map(choice => choice.optionId)).size !== group.choices.length ||
              group.choices.some(choice => (choice.custom !== undefined) === (choice.duration !== undefined)))) {
          throw new ConnectorError("connector_input_invalid", "Use at most 1000 participants, distinct options per group and exactly one custom or duration value per choice.", { statusCode: 422, messageCode: "connectors.wix.useMost1000ParticipantsDistinct" });
        }
      }
      if (kind === "APPOINTMENT" ? !startDate || !endDate || startDate >= endDate || !resourceId || !location || eventId || scheduleId :
          kind === "CLASS" ? !eventId || startDate || endDate || resourceId || location || scheduleId : !scheduleId || startDate || endDate || resourceId || location || eventId) {
        throw new ConnectorError("connector_input_invalid", "Use appointment dates/resource/location, a class event ID, or a course schedule ID, matching the selected service type.", { statusCode: 422, messageCode: "connectors.wix.useAppointmentDatesResourceLocation" });
      }
      if (location?.locationType === "OWNER_BUSINESS" && !location.id) throw new ConnectorError("connector_input_invalid", "Choose the business location ID.", { statusCode: 422, messageCode: "connectors.wix.chooseBusinessLocationId" });
      const bookedEntity = kind === "COURSE" ? { schedule: { scheduleId, serviceId, timezone: timeZone } } :
        { slot: { serviceId, timezone: timeZone, ...(kind === "CLASS" ? { eventId } : { startDate, endDate, resource: { id: resourceId }, location }) } };
      return { method: "POST", url: "https://www.wixapis.com/_api/bookings-service/v2/bookings",
        body: { booking: { bookedEntity, ...(participantsChoices ? { participantsChoices } : { totalParticipants: totalParticipants ?? 1 }),
          ...(bookedAddOns ? { bookedAddOns } : {}) }, formSubmission, participantNotification: { notifyParticipants }, sendSmsReminder } };
    },
    validateResult: value => isUuid(value?.booking?.id) && typeof value.booking.revision === "string" && /^\d{1,19}$/u.test(value.booking.revision) &&
      BigInt(value.booking.revision) <= 9223372036854775807n && typeof value.booking.status === "string" && value.booking.status.length > 0
  },
  "availability.list": availabilityOperation("list"),
  "availability.get": availabilityOperation("get"),
  "bookings.list": {
    scopes: [],
    request(input) {
      const { bookingId, ...paging } = validateSchemaPayload({ schema: bookingQuerySchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: "https://www.wixapis.com/_api/bookings-reader/v2/extended-bookings/query",
        body: { query: { paging, ...(bookingId ? { filter: { id: bookingId } } : {}) }, withBookingAllowedActions: true } };
    },
    validateResult: (value, request) => Array.isArray(value?.extendedBookings) && value.extendedBookings.length <= 100 && value.extendedBookings.every(record =>
      isUuid(record?.booking?.id) && typeof record.booking.revision === "string" && /^\d{1,19}$/u.test(record.booking.revision) && BigInt(record.booking.revision) <= 9223372036854775807n &&
      typeof record.booking.status === "string" && record.booking.status.length > 0 &&
      (record.allowedActions === undefined || record.allowedActions && typeof record.allowedActions === "object" && !Array.isArray(record.allowedActions) &&
        ["cancel", "reschedule"].every(key => record.allowedActions[key] === undefined || typeof record.allowedActions[key] === "boolean"))) &&
      (value.pagingMetadata === undefined || value.pagingMetadata && typeof value.pagingMetadata === "object" && !Array.isArray(value.pagingMetadata) &&
        ["count", "offset", "total"].every(key => value.pagingMetadata[key] === undefined || Number.isSafeInteger(value.pagingMetadata[key]) && value.pagingMetadata[key] >= 0) &&
        (value.pagingMetadata.count === undefined || value.pagingMetadata.count === value.extendedBookings.length)) &&
      (!request.body.query.filter?.id || sameRecord(value.extendedBookings.length <= 1 && value.extendedBookings.every(record => record.booking.id === request.body.query.filter.id),
        "Wix returned an unexpected booking for the requested ID.", { messageCode: "connectors.wix.returnedUnexpectedBookingRequestedId" }))
  },
  "bookings.cancel": {
    scopes: [],
    request(input) {
      const { bookingId, revision, notifyParticipants, message, waiveCharges } = validateSchemaPayload({ schema: bookingCancelSchema, mode: "replace" }, input, { statusCode: 422 });
      if (message && !notifyParticipants) throw new ConnectorError("connector_input_invalid", "Enable participant notification to send a cancellation message.", { statusCode: 422, messageCode: "connectors.wix.enableParticipantNotificationSendCancellation" });
      return { method: "POST", url: `https://www.wixapis.com/_api/bookings-service/v2/bookings/${bookingId}/cancel`,
        body: { revision, waiveCharges,
          participantNotification: { notifyParticipants, ...(message === undefined ? {} : { message }) } } };
    },
    validateResult: (value, request) => isUuid(value?.booking?.id) && sameRecord(value.booking.id === requestPath(request, -2), "Wix returned a different booking. Check the operation outcome before retrying.", { messageCode: "connectors.wix.returnedDifferentBookingCheckOperation" }) && value.booking.status === "CANCELED" &&
      typeof value.booking.revision === "string" && /^\d{1,19}$/u.test(value.booking.revision) && BigInt(value.booking.revision) <= 9223372036854775807n
  },
  "bookingServices.list": {
    scopes: [],
    request(input) {
      const paging = validateSchemaPayload({ schema: servicePagingSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: "https://www.wixapis.com/_api/bookings/v2/services/query", body: { query: { paging } } };
    },
    validateResult: value => Array.isArray(value?.services) && value.services.length <= 100 && value.services.every(validService) &&
      (value.pagingMetadata === undefined || value.pagingMetadata && typeof value.pagingMetadata === "object" && !Array.isArray(value.pagingMetadata) &&
        ["count", "offset", "total"].every(key => value.pagingMetadata[key] === undefined || Number.isSafeInteger(value.pagingMetadata[key]) && value.pagingMetadata[key] >= 0) &&
        (value.pagingMetadata.count === undefined || value.pagingMetadata.count === value.services.length))
  },
  "bookingServices.get": {
    scopes: [],
    request(input) {
      const { serviceId } = validateSchemaPayload({ schema: serviceIdSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "GET", url: `https://www.wixapis.com/_api/bookings/v2/services/${serviceId}` };
    }, validateResult: (value, request) => validService(value?.service) && sameRecord(value.service.id === requestPath(request, -1), "Wix returned a different booking service. Check the outcome before retrying.", { messageCode: "connectors.wix.returnedDifferentBookingServiceCheck" })
  },
  "bookingServices.update": {
    scopes: [],
    request(input) {
      const { serviceId, ...service } = validateSchemaPayload({ schema: serviceUpdateSchema, mode: "replace" }, input, { statusCode: 422 });
      if (Object.keys(service).length < 2) throw new ConnectorError("connector_input_invalid", "Choose a service field to update.", { statusCode: 422, messageCode: "connectors.wix.chooseServiceFieldUpdate" });
      if (["payment", "onlineBooking"].some(key => service[key] !== undefined && !Object.keys(service[key]).length) ||
          service.schedule && !Object.keys(service.schedule.availabilityConstraints).length) {
        throw new ConnectorError("connector_input_invalid", "Provide the selected service settings instead of an empty object.", { statusCode: 422, messageCode: "connectors.wix.provideSelectedServiceSettingsInstead" });
      }
      return { method: "PATCH", url: `https://www.wixapis.com/_api/bookings/v2/services/${serviceId}`, body: { service: { id: serviceId, ...service } } };
    }, validateResult: (value, request) => validService(value?.service) && sameRecord(value.service.id === requestPath(request, -1), "Wix returned a different booking service. Check the outcome before retrying.", { messageCode: "connectors.wix.returnedDifferentBookingServiceCheck" })
  }
};

export { wixBookingOperations };
