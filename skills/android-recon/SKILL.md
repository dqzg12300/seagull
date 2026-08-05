---
name: android-recon
description: Triage an APK, map its network surface, and locate Java-to-JNI paths using the connected Jadx MCP tools.
---

# Android Recon

Work only inside an active reverse case.

Planning gate: read the active run's `<taskDir>/request.md` first (fall back to legacy `artifacts/analysis-request.md` only for old cases). Before target analysis, decompose the request, choose only the necessary static, dynamic, emulation, and replay routes, define success and stop criteria, write/register `<taskDir>/plan.md`, then call `reverse_analysis_plan` with only the selected stages. Put every new artifact and evidence item under the active Work directory; access upstream Work directories read-only. Use `reverse_analysis_step` throughout execution and reuse existing evidence where it already answers the request.

1. Record the APK hash, package, SDK levels, ABIs, manifest components, permissions, network-security configuration, and bundled native libraries.
   Produce a concise manifest summary and preserve both JADX and apktool outputs when available. A partial JADX failure is an evidence boundary, not a reason to discard successfully recovered classes; fall back to smali/resources for missing regions.
2. Use the Jadx MCP tools to locate HTTP clients, base URLs, interceptors, serializers, signing headers, encryption calls, and native declarations.
3. Build a call-chain table from request construction back to the data/signature source. Preserve exact class and method identifiers.
4. If the implementation is Java/Kotlin, advance to `RECOVER_ALGORITHM`. If it crosses JNI, record the Java declaration, library name, JNI signature, and advance to `NATIVE_RECON`.
5. Call `reverse_case_update` after every confirmed phase. Do not claim an algorithm is recovered until test vectors match runtime behavior.
6. Finalization is mandatory: synthesize the registered evidence into `.pi/cases/<case-id>/artifacts/report.md`. The report must separate confirmed facts, runtime verification, limitations, and reproduction steps. Register the report path with `reverse_case_update`; never leave a case at `REPORT` without this artifact.

When rebuilding is required, use an isolated derived apktool tree and verify build, alignment, signing identity, installation, and launch. Never overwrite the original APK or silently auto-install missing host tools.

Deliver an inventory, call chain, confirmed branch, unresolved blockers, and exact next tool action.
