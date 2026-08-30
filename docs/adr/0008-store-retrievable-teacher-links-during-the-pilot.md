---
status: accepted
---

# Store retrievable Teacher Access Links during the Pilot

The Pilot administration panel must display and copy the current Teacher Access Link. VVE therefore stores the active token in recoverable form, and the cheapest acceptable Pilot implementation may store it as plaintext in the protected database instead of keeping only a hash.

## Consequences

Database access exposes Teacher credentials, but the accepted Pilot threat model treats this as lower risk than disrupting teachers through unnecessary link regeneration. Before the Company Rollout, VVE will revisit encrypted-at-rest storage without changing the access-link product model.
