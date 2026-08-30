---
status: accepted
---

# Exchange a shared Administrator passphrase for a short session

VVE uses one shared Administrator passphrase instead of Administrator accounts. The backend exchanges it for a signed, twelve-hour session in a secure HttpOnly cookie, while the passphrase and signing secret remain server-side Railway variables. This gives the small internal administration team a low-cost login without placing a permanent secret in URLs, browser storage, or frontend code.

## Consequences

The login endpoint limits failed attempts, and all Administrator operations enforce the session on the backend. The shared passphrase does not provide individual audit identity or MFA; VVE may replace it with named accounts or an access proxy if the administration team or risk grows.
