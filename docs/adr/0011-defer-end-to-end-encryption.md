---
status: accepted
---

# Defer end-to-end encryption

End-to-end encryption is not a Pilot or near-term requirement. The current interface and documentation must not claim that it works, because the existing transport sends raw Yjs updates and the encryption helpers do not protect collaboration traffic. VVE may revisit the concept in the distant future, but the Pilot architecture will not absorb extra complexity to preserve the unfinished experiment.
