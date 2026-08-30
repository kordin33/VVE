# Use One Immutable Public Teacher Identity

## Status

Accepted

## Context

VVE grants access through capability links and does not expose Teacher or Student accounts. The tutoring company deliberately does not want a Student-facing identity system or individual Teacher identities in the Pilot. Allowing participants to rename themselves would create an unsupported identity claim and make the intentionally narrow access model harder to reason about.

## Decision

Every Teacher is shown to every Student under the exact immutable Public Teacher Identity `Dawid Furmaniuk - Matsin`.

A Student cannot change the Public Teacher Identity or choose their own Collaborator Label. Student cursor labels and colors are assigned by the system and are only ephemeral collaboration markers, not verified identities.

## Consequences

- Student-facing UI must not expose a Teacher's internal Student Label, real name, or editable display name.
- All Teacher identities appear identical to Students by design.
- The system avoids adding account profiles or identity verification solely for collaboration labels.
- If the company later needs distinct public Teacher identities, it will require an explicit product and data-model decision rather than an incidental UI change.
