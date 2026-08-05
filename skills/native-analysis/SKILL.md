---
name: native-analysis
description: Recover Android native signing or encryption behavior through IDA MCP, Frida MCP, and Unidbg validation.
---

# Native Analysis

1. Correlate the JNI declaration from Jadx with dynamic registration, exports, strings, and xrefs in IDA.
2. Record module-relative offsets, function prototypes, callers, callees, constants, structs, and algorithm hypotheses.
   Begin with a binary survey, then narrow by imports, strings, xrefs, call graphs, and forward/backward data flow. Apply stable names, types, and comments only after evidence supports them; preserve an auditable symbol map.
3. Use Frida to capture controlled input/output pairs at the narrowest stable Java or Native boundary. Prefer offsets over runtime absolute addresses in saved notes.
4. Standard algorithms should be reimplemented with explicit encoding, padding, mode, key derivation, IV/nonce, and output formatting.
5. For custom, environment-coupled, or heavily obfuscated code, generate an Unidbg harness and implement missing JNI/system stubs incrementally.
6. Verify recovered behavior against at least two runtime samples before advancing the case to `VERIFY`.

For follow-up versions, reuse confirmed symbols through exact normalized matches or multiple independent anchors such as JNI descriptors, constants, strings, call neighborhoods, CFG shape, and imports. Keep uncertain migrations separate from confirmed names.

Persist tool evidence automatically and use `reverse_case_update` for confirmed observations and artifact paths.
