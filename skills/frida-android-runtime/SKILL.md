---
name: frida-android-runtime
description: Design and run scoped Frida instrumentation for Android Java, JNI, native libraries, system APIs, and evidence-grade runtime traces.
---

# Frida Android Runtime

Use Frida only to answer a stated runtime hypothesis. Prefer narrow hooks and structured evidence over broad noisy tracing.

1. Confirm device, process, ABI, package, spawn/attach mode, Frida version compatibility, and module load timing.
2. Map the static target to its runtime identity: Java overload signature, JNI registration, module-relative native offset, or exported symbol.
3. Hook the narrowest stable boundary. Record timestamp, thread, module base, relative address, typed arguments, return value, and a bounded backtrace.
4. Guard Java hooks with `Java.perform`; handle overloads explicitly. Guard native reads with pointer validity and bounded lengths.
5. For fingerprint collection, group hooks by system properties, files, identifiers, packages/processes, network interfaces, sensors, and native syscalls. Deduplicate repeated events.
6. Persist JSONL traces and a hook manifest. Redact credentials and personal data unless the analysis explicitly requires controlled test values.
7. Validate with controlled input changes and at least two samples before claiming a transform or source relationship.

Deliver the reusable Frida script, launch command, target assumptions, structured trace, static/runtime correlation, and known blind spots.
