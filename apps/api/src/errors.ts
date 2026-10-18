// The one error type a route throws. Everything else that escapes a handler
// is an accident, and the envelope middleware turns it into a 500 that says
// nothing about what went wrong inside.

export class ApiError extends Error {
  // Assigned in the body rather than declared as constructor parameter
  // properties: `erasableSyntaxOnly` forbids those, because they are the one
  // piece of TypeScript syntax that emits runtime code.
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
