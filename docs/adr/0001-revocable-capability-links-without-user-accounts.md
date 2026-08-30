---
status: accepted
---

# Use revocable capability links without user accounts

VVE grants Teachers and Students access through revocable long-lived capability links instead of accounts, passwords, or email login. This keeps the internal tutoring workflow cheap and frictionless while the product contains no payments or intentionally sensitive records. Administrators control link creation and revocation, and possession of a link grants its authority until it expires or is revoked. Teacher Access Links do not expire automatically during the Pilot.

## Consequences

Access links are credentials even though the product does not call them passwords. A leaked or forwarded link permits access within its scope until an Administrator or Teacher revokes it. VVE deliberately does not bind a link to a person, browser, or device. The same link may be open in several sessions at once.

Each Teacher has exactly one active Teacher Access Link. Each Managed Board has exactly one active Board Access Link. Viewing the administration panel never creates or rotates links; regeneration is an explicit action that immediately invalidates the previous link without deleting board data. During the Pilot the Administrator may retrieve the existing Teacher Access Link value from the administration panel; stronger at-rest protection may be introduced before the Company Rollout.
