const DEG2RAD_API_PATH = "/api/deg2rad";

function createApi({ request }) {
  return {
    calculate(payload) {
      return request(DEG2RAD_API_PATH, { method: "POST", body: payload });
    }
  };
}

export { createApi };
