# VVE Pilot implementation ticket graph

The tickets below implement [Implement the VVE Pilot product contract](tracker/issues/VVE-001-implement-vve-pilot-product-contract.md). Each ticket is an autonomous vertical slice. The detailed Module and Interface design, migration constraints, evidence, and slice acceptance criteria live in [VVE Deep Module Design](../architecture/VVE-DEEP-MODULE-DESIGN.md).

## Graph

```text
VVE-100 Pilot surface and test spine
  └─ VVE-101 Capability links and Administrator flow
       └─ VVE-102 Managed and Personal Board lifecycle
            └─ VVE-103 Acknowledged durable lesson
                 ├─ VVE-104 Core whiteboard commands
                 │    ├─ VVE-105 Pointer and iPad input
                 │    ├─ VVE-106 Math, physics, and object tools
                 │    └─ VVE-107 PDF, images, and resource safety
                 └─ VVE-108 Runtime recovery and observability

VVE-110 Pilot UI fidelity depends on VVE-100, VVE-101, VVE-102, and VVE-104 through VVE-107.
VVE-109 Pilot release gates depends on VVE-105 through VVE-108 and VVE-110.
```

## Frontier order

1. Initial frontier: [Pilot surface and test spine](tracker/issues/VVE-100-pilot-surface-and-test-spine.md).
2. The capability and lifecycle chain opens one ticket at a time through [Acknowledged durable lesson](tracker/issues/VVE-103-acknowledged-durable-lesson.md). These slices establish shared Interfaces that later agents consume.
3. After the durable lesson lands, [Runtime recovery and observability](tracker/issues/VVE-108-runtime-recovery-and-observability.md) can run beside [Core whiteboard commands](tracker/issues/VVE-104-core-whiteboard-commands.md).
4. Core commands opens three parallel slices: [Pointer and iPad input](tracker/issues/VVE-105-pointer-and-ipad-input.md), [Math, physics, and object tool completion](tracker/issues/VVE-106-math-physics-and-object-tool-completion.md), and [PDF, images, and resource safety](tracker/issues/VVE-107-pdf-images-and-resource-safety.md).
5. [Pilot UI fidelity](tracker/issues/VVE-110-pilot-ui-fidelity.md) converges the completed visible flows.
6. [Pilot release gates](tracker/issues/VVE-109-pilot-release-gates.md) closes the graph with integrated evidence.

## Ticket completion

A ticket closes only when:

- every acceptance criterion in its matching S-section of the deep-module design passes;
- replaced legacy paths and superseded source-text tests are removed;
- the implementation commit, behavioral tests, runtime evidence, and known deviations are linked from the ticket resolution;
- its Module Interfaces match the accepted design or the resolution records an evidence-backed improvement in Depth, Leverage, and Locality;
- the integrated PR branch passes the ticket's focused gate.

The final hardware confirmation remains Kordian's external release action. The implementation PR must complete the automated and Browser evidence that makes it a confirmation rather than a discovery loop.

