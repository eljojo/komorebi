// Thrown anywhere in a request; the app turns it into `{ error, ...details }` with this status.
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
