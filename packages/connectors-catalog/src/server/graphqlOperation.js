import { jsonOperation } from "./jsonOperation.js";

function graphqlOperation(url, query, fields, validateData) {
  const operation = jsonOperation(url, fields,
    (result) => (result?.errors === undefined || (Array.isArray(result.errors) && result.errors.length === 0)) && validateData(result?.data), "POST");
  return {
    ...operation,
    request(input, settings) {
      const request = operation.request(input, settings);
      return { ...request, body: { query, variables: request.body } };
    }
  };
}

export { graphqlOperation };
