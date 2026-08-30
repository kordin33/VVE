---
status: accepted
---

# Disable AI functionality during the Pilot

AI controls and access are disabled for every Pilot user. Pilot deployment disables the backend routes as well as hiding the interface, so manually calling an endpoint cannot activate AI. The implementation may remain in the repository for later development, but Lesson Sessions, board entry, persistence, and export must not depend on an AI provider, model key, or AI route.
