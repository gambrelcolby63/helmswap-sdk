/** Error from the Helm v1 API, with the HTTP status and the server's code (if any). */
export class HelmApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: unknown;
  constructor(status: number, message: string, code: string | null, body: unknown) {
    super(message);
    this.name = "HelmApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
  /** 451: a tokenized stock is on one side. The swap is refused; do not retry with the same pair. */
  get isTokenizedEquityBlocked(): boolean {
    return this.status === 451;
  }
  /** 401: unknown or disabled x-api-key. Fix the key, or omit it for the keyless 20% tier. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  /** 409: the quote ticket expired or the price moved >30 bps. Request a new quote. */
  get isQuoteStale(): boolean {
    return this.status === 409;
  }
  /** 429: rate limited. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/** Thrown before any request when input is invalid (including anything that looks like a private key). */
export class HelmInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HelmInputError";
  }
}
