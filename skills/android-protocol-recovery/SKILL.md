---
name: android-protocol-recovery
description: Recover and verify Android application protocols from APK code, native libraries, runtime traces, PCAPs, WebSocket traffic, Protobuf or gRPC payloads, custom binary frames, serializers, checksums, signatures, compression, and encryption boundaries. Use when a case needs message framing, field provenance, state-machine reconstruction, a parser or encoder, round-trip validation, or a handoff to request replay.
---

# Android Protocol Recovery

Preserve raw captures and upstream case artifacts. Store derived parsers, schemas, samples, and reports in the current case workspace.

1. Read the analysis request, active plan, existing Java/native findings, captures, and replay artifacts. Reuse confirmed evidence.
2. Identify transports and boundaries: HTTP bodies, WebSocket messages, TCP/UDP streams, Binder payloads, protobuf/gRPC, Java serializers, JNI transitions, and native socket or crypto calls.
3. Collect at least two controlled input/output samples when runtime access exists. Hook immediately before serialization/encryption and after decryption/deserialization; retain timestamps and connection/message correlation.
4. Infer framing before fields: direction, message type, length, sequence, flags, checksum/MAC, compression, payload, and stream reassembly. Distinguish observed bytes from inferred semantics.
5. Trace each important field back through Java, JNI, native code, device state, constants, and prior messages. Use JADX for Java/Kotlin, IDA for native code, and Frida for boundary evidence.
6. Build a deterministic parser first, then an encoder. Preserve unknown fields and reject malformed lengths instead of silently guessing.
7. Validate by parse-serialize round trips, captured sample tests, checksum/signature reproduction, and—only when in scope—controlled replay.
8. Register a protocol specification, annotated samples, parser/encoder source, tests, field-provenance table, unresolved fields, and verification results.

Read [references/protocol-artifacts.md](references/protocol-artifacts.md) when defining output files or acceptance criteria.

Do not claim encryption or signing recovery merely because plaintext was observed at a hook boundary. Record key/nonce derivation, encoding, canonicalization, and test vectors separately.
