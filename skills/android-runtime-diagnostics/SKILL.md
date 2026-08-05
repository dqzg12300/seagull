---
name: android-runtime-diagnostics
description: Diagnose a live Android application on an ADB-connected device by reproducing crashes, ANRs, visible errors, incorrect values, missing data, bad UI state, or environment-dependent behavior and correlating runtime evidence with decompiled APK, Java/Kotlin, JNI, and native code. Use for field diagnosis requiring logcat, dumpsys, crash or tombstone evidence, device and package state, controlled Frida observation, static call-chain analysis, root-cause isolation, and focused verification.
---

# Android Runtime Diagnostics

Work inside the active case and preserve the device state relevant to the reported symptom. Avoid broad collection when a narrow reproduction window is possible.

1. Record the connected device serial, Android build, ABI, package, installed version, process, foreground activity, APK hash/version relationship, and exact symptom.
2. Define a reproducible action sequence, expected result, observed result, time window, and stop condition. Do not begin broad static analysis before establishing the failing observation.
3. Capture a clean baseline, clear only task-scoped buffers when appropriate, reproduce once, and collect timestamp-correlated evidence. Choose only relevant sources:
   - Java crash or visible error: filtered logcat, exception chain, process state, activity/service state.
   - ANR or hang: traces, main-thread state, CPU/memory pressure, binder and service state.
   - Native crash: tombstone, ABI, module/build ID, relative PC, signal, registers, backtrace, and mapped library.
   - Incorrect value or missing data: UI/API observation, controlled inputs, serializer/JNI boundaries, relevant storage and network state.
4. Map runtime class, method, address, field, or message back to JADX and IDA evidence. Preserve exact identifiers and module-relative addresses.
5. Add the narrowest Frida observation only when logs and static evidence cannot distinguish hypotheses. Prefer read-only hooks and controlled inputs.
6. Build a ranked hypothesis table. For every candidate, record supporting evidence, contradicting evidence, and the cheapest discriminating check.
7. Verify the root cause with a focused reproduction or instrumentation change. Distinguish application defect, device/environment dependency, backend/data issue, and analysis limitation.
8. Register the reproduction recipe, device snapshot, raw logs, normalized incident timeline, static/runtime correlation, root-cause report, and verification result.

Read [references/diagnostic-artifacts.md](references/diagnostic-artifacts.md) before naming outputs or declaring the incident resolved.

Do not claim a root cause from a nearby log line alone. Require temporal correlation plus a code/data path or a discriminating verification result.
