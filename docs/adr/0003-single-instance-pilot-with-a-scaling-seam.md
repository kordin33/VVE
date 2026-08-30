---
status: accepted
---

# Run the Pilot on one instance without blocking horizontal scaling

The Pilot runs on one Railway application instance and supports no more than 20 selected Teachers, their real Students, and many simultaneous Managed Boards. VVE will not implement distributed document ownership before measurements require it, but collaboration behavior will sit behind a small interface so a multi-instance adapter can be added without redesigning the board or its access model.

## Consequences

Reaching the 20-Teacher Pilot limit triggers cost analysis, load tests, and design for the Company Rollout. Process-local state is acceptable during the Pilot only when it does not disrupt two- or three-hour Lesson Sessions and the implementation does not present it as a cross-instance guarantee.

The Pilot capacity gate uses 22 concurrent Teachers and 35 concurrent Students, for 57 active clients. This already exceeds the expected real concurrency. A separate 88-client run, with one Teacher and three Students on each of 22 boards, is a diagnostic stress target rather than a release requirement. VVE will not add architectural complexity solely to make the 88-client run pass when the 57-client gate is stable and the larger run fails safely without data corruption or cross-board leakage.
