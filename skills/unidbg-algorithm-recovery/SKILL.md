---
name: unidbg-algorithm-recovery
description: Recover and verify Android JNI or native algorithms with a minimal reproducible Unidbg harness and controlled environment emulation.
---

# Unidbg Algorithm Recovery

Use when an algorithm is implemented in an Android SO and needs repeatable execution outside the original app.

1. Record ABI, library dependencies, JNI entry path, registration mode, Java argument types, return type, and required application context.
2. Start with the smallest emulator configuration that matches the target ABI/API level. Load dependencies explicitly and call `JNI_OnLoad` when required.
3. Recreate Java objects and native inputs from captured runtime samples. Never invent missing encoding, locale, time, device, or filesystem state.
4. Implement missing JNI, system property, file, linker, and syscall behavior incrementally from observed failures. Log every stub and its justification.
5. Separate environment emulation from the recovered algorithm adapter so fixtures can run deterministically.
6. Compare outputs with at least two Frida-captured input/output pairs. Diagnose mismatches at canonicalization, encoding, state, time/nonce, and native dependency boundaries.
7. Preserve console logs, resolved symbols, patches, fixtures, and the final executable harness.

Deliver buildable Java code, dependency versions, run command, environment shim inventory, fixtures, output comparison, and confidence limits.
