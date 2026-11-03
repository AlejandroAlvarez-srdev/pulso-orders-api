# Security

Pulso is a fictional company; this repository is a portfolio project. Please report anything you
find by opening an issue rather than relying on a private disclosure channel.

## Dependency policy

- Production dependencies are pinned to exact versions and audited with
  `npm audit --omit=dev`. CI fails on critical advisories in production dependencies.
- New releases wait **14 days** before adoption unless the advisory is actively exploited and
  reachable. That window has caught compromised and broken publishes on npm before.
- When a fix exists only in a transitive dependency, it is applied with an npm `overrides`
  entry, pinned to an exact version that has been out for at least 14 days, and the
  suite plus the Prisma CLI (`generate`, `migrate deploy`) are re-run.
- Fixes that need a major upgrade of a framework (NestJS 12, Prisma 7+) are planned as separate
  changes, not bundled with advisory fixes.

## Applied overrides (November 2026)

| Package | From → to | Advisory | Pulled in by |
| --- | --- | --- | --- |
| `js-yaml` | 5.3.0 → 5.4.3 | [GHSA-r3ph-w7gj-g6xm](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm) (CPU exhaustion via merge keys) | `@nestjs/swagger` 11 |
| `deepmerge-ts` | 7.1.5 → 8.0.2 | [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) (stack exhaustion on recursive graphs) | `prisma` 6 (`@prisma/config`) |

`deepmerge-ts` 8 is a major version; Prisma only uses it to merge CLI configuration. It was
verified with `prisma generate`, `prisma validate`, `prisma migrate status/deploy` against
PostgreSQL and the full test suite.

## Known, accepted advisories

| Package | Advisory | Severity | Why it is accepted for now |
| --- | --- | --- | --- |
| `multer` 2.4.0 (via `@nestjs/platform-express` 11) | [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m): DoS through a pending async `fileFilter` after request teardown | High | **Not reachable**: multer only runs behind Nest's `FileInterceptor`, and this API has no multipart routes. The only fix, `multer` 2.5.0, was published on 2026-10-22, inside the 14-day window. It will be pinned through `overrides` once the window ends, or removed by the NestJS 12 upgrade. |

Advisories in development tooling (`eslint`, `jest`, `ts-jest`, `minimatch`, `glob`) do not reach
the runtime image. The Dockerfile prunes dev dependencies before building the final stage.

## Hardening already in place

- API keys are stored only as SHA-256 hashes. JWTs are HS256 with a 32+ character secret,
  issuer pinning and short expiry.
- Tenant scope comes only from the verified token. Other merchants' orders return 404.
- Validation whitelists DTO fields and rejects unknown ones. Error documents never include
  internal error messages.
- Caller-supplied `X-Request-Id` values are accepted only if they are short and log-safe.
- The container runs as the unprivileged `node` user, with application files owned by root.
