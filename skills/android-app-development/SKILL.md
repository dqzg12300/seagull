---
name: android-app-development
description: Design, implement, build, test, and package a new Android application from product requirements while reusing relevant reverse-engineering findings, reconstructed apps, device-behavior evidence, protocols, APIs, and prior case experience. Use for new Kotlin or Java Android apps, validation and diagnostic apps, device-information viewers, companion tools, protocol clients, test harnesses, and downstream apps built from an existing Seagull case.
---

# Android App Development

Build a maintainable new application in the assigned development project directory. Treat inherited case history and artifacts as design evidence, not as files to overwrite.

## Establish requirements

1. Read the current case state, historical objectives, reports, registered artifacts, reconstruction projects, and task request.
2. Convert the request into user-visible features, required data, supported Android versions, permissions, privacy constraints, offline/network behavior, and acceptance criteria.
3. Separate confirmed inherited behavior from assumptions. Reuse verified protocols, device-field meanings, edge cases, and test vectors where relevant.
4. Select the smallest architecture that satisfies the request. Avoid copying obsolete or obfuscated architecture into a new app.

## Plan dynamically

Choose only required stages from product specification, UI flow, project scaffolding, data/domain model, platform integrations, storage/networking, implementation, tests, build, device validation, and delivery.

For diagnostic or validation applications:

- display raw and normalized values separately;
- show source API, availability, permission state, timestamp, and collection errors;
- provide refresh and copy/export actions where useful;
- avoid silently inventing unavailable identifiers;
- make comparisons with inherited behavior explicit and reproducible.

## Implement

- Prefer Kotlin, AndroidX, Material components, coroutines, and a conventional Gradle structure unless the case imposes compatibility constraints.
- Keep platform access behind interfaces so device-dependent behavior can be tested.
- Request only necessary permissions and explain restricted or version-gated APIs in the UI.
- Keep secrets and production credentials out of source. Use configuration placeholders and document integration points.
- Preserve inherited artifacts and prior projects. Copy or adapt code only into the assigned project and record its provenance.
- Handle loading, empty, permission-denied, unsupported, partial-data, and failure states.

## Verify

Run progressive checks:

1. Gradle configuration and dependency resolution.
2. Lint, unit tests, and compilation.
3. APK assembly and manifest/package inspection.
4. Installation and launch on an available emulator or device.
5. Feature-level acceptance checks using inherited samples and expected behavior.
6. Export or screenshot evidence when the objective requires manual validation.

Save exact build/test commands and errors. Mark requirements complete only with build, test, runtime, or inherited evidence.

## Deliver

Provide the complete project, architecture summary, build/install commands, feature inventory, acceptance results, screenshots or logs when relevant, and explicit limitations. Register the project and delivery record with the current case.
