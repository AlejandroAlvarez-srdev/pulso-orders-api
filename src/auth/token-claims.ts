/** JWT payload issued by POST /auth/token. `sub` is the merchant id. */
export interface TokenClaims {
  sub: string;
  /** Space-delimited scopes, as in RFC 8693 / OAuth 2.0. */
  scope: string;
}
