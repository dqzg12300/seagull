---
name: android-app-reconstruction
description: Reconstruct a compilable and verifiable Android application or compatible replacement from inherited APK decompilation, deobfuscation, resource, manifest, native-library, runtime, and analysis artifacts. Use for downstream app reconstruction, source recovery, clean-room module reimplementation, Gradle project restoration, UI/resource recovery, build repair, installation testing, and behavior-parity verification after reverse engineering.
---

# Android App Reconstruction

Treat reconstruction as a downstream engineering task. Preserve upstream evidence and write only inside the assigned reconstruction project and task directories.

## Establish the contract

1. Read the task request, upstream artifact snapshot, case state, reports, readable source trees, symbol maps, resources, manifests, native findings, and validation notes.
2. Record missing or unreliable inputs, including decompiler failures, unresolved symbols, absent resources, unavailable services, and behavior that was not dynamically verified.
3. Classify the requested outcome:
   - **Compilable recovery**: maximize faithful source and resource recovery.
   - **Functional reimplementation**: rebuild required behavior with maintainable code rather than mirroring damaged structure.
   - **Compatible replacement**: preserve defined interfaces, protocol behavior, inputs, and outputs while redesigning internals.
4. Convert the operator's requirements into observable acceptance criteria before editing code.

## Plan dynamically

Select only necessary stages. Typical stages are artifact audit, architecture plan, project scaffolding, manifest/resources, Java/Kotlin migration, native integration or replacement, build repair, installation/launch, behavior verification, and delivery. Do not force UI or native work when the objective does not require it.

For every module, choose and document one strategy:

- recover directly when semantics and dependencies are reliable;
- rewrite cleanly when decompiled structure is unsafe or unreadable;
- wrap an inherited binary only when redistribution and runtime constraints permit it;
- stub temporarily only when the acceptance criteria exclude that behavior, and list every stub in delivery notes.

## Build the project

- Create a conventional Gradle Android project in the assigned project directory.
- Prefer Kotlin for new orchestration code; preserve Java where direct recovery reduces risk.
- Reconstruct package/application IDs, SDK levels, components, permissions, providers, resources, and ABI packaging deliberately. Do not copy privileged or obsolete settings without justification.
- Keep recovered code separate from handwritten adapters until its behavior is verified.
- Replace unavailable proprietary services behind interfaces so test doubles and later integrations remain possible.
- Never fabricate signing keys, backend secrets, production credentials, or unverified protocol behavior.

## Verify continuously

Run the smallest useful check after each material step:

1. Gradle configuration and dependency resolution.
2. Resource and manifest processing.
3. Java/Kotlin/native compilation.
4. APK assembly and package inspection.
5. Installation and launch on an available emulator/device.
6. Acceptance tests and behavior comparison against confirmed upstream observations.

When a check fails, save the exact command and error, fix the root cause, and rerun it. Mark behavior as confirmed only when supported by a build, test, runtime trace, or inherited evidence.

## Deliver

Produce:

- the complete project under the assigned project directory;
- a concise architecture and recovery-strategy record;
- build, install, and test commands;
- acceptance results with evidence links;
- an inventory of recovered, rewritten, wrapped, stubbed, and unresolved components;
- limitations involving services, signatures, hardware, native dependencies, or unavailable runtime conditions.

Register important outputs with the case and keep upstream artifacts immutable.
