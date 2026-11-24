/**
 * A refusal of an OAuth client's request to the token or revocation endpoint, which the endpoint answers as RFC 6749
 * section 5.2 says: `{ error, error_description }` with the status (400, or 401 for invalid_client). It is said to a
 * client program, not a person, so it carries the protocol's code and English, not a catalog message.
 */
class ClientAuthorizationError extends Error {
  /**
   * @param {string} error The RFC 6749 error code, such as invalid_grant.
   * @param {string} description
   * @param {number} [status]
   */
  constructor(error, description, status = 400) {
    super(description);
    this.name = "ClientAuthorizationError";
    this.error = error;
    this.status = status;
  }
}

export { ClientAuthorizationError };
