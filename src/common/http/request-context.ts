/** Authenticated caller resolved from the bearer token. */
export interface Principal {
  merchantId: string;
  scopes: readonly string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlation id: propagated from `X-Request-Id` or generated per request. */
    id: string;
    principal?: Principal;
  }
}
