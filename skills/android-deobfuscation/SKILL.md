---
name: android-deobfuscation
description: Iteratively recover human-readable Java, Kotlin, DEX, and JNI code from obfuscated Android packages and verify semantic equivalence.
---

# Android Deobfuscation

Use for R8/ProGuard naming, string encryption, proxy methods, reflection, control-flow flattening, dynamic loading, and Java/native mixed obfuscation.

1. Preserve the APK and every original decompiler output. Write transformations only to a derived artifact tree.
2. Inventory obfuscation by layer: identifiers, strings, calls, reflection, resources, DEX loading, JNI, packer, and anti-analysis behavior.
3. Build stable anchors from manifest components, framework callbacks, SDK signatures, constants, URLs, resource IDs, JNI declarations, and xrefs.
4. Apply small deterministic transformations. Emit symbol maps, transformation manifests, and before/after samples.
5. Verify structural integrity, call targets, decoded literals, and behavior after every pass. Treat JADX decompilation failures as evidence boundaries, not decoded behavior.
6. Repeat only where readability criteria fail. Stop with a documented residual-obfuscation list when another pass would be speculative.

Deliver friendly indexed source, symbol/call maps, decoded literals, transformation scripts, residual blockers, and a readability verification report.
