---
name: pcap-network-analysis
description: Analyze PCAP, PCAPNG, CAP, HAR, tcpdump, Wireshark, or tshark network captures to reconstruct conversations, diagnose transport and application behavior, extract structured evidence, and correlate packets with Android application code or runtime events. Use for packet-capture triage, endpoint and protocol inventories, TCP/UDP stream analysis, DNS/HTTP/TLS/QUIC behavior, loss or retransmission diagnosis, timing analysis, custom protocol investigation, and evidence-linked network findings. Do not activate for ordinary networking code changes without capture or traffic-analysis requirements.
---

# PCAP Network Analysis

Treat captures as immutable evidence. Work on derived files inside the active Work directory and record the capture hash, format, size, time range, link type, snap length, interfaces, and truncation or corruption warnings before drawing conclusions.

1. Read the operator objective and identify the narrow question, relevant hosts, device/app identity, expected time window, and any available reproduction timestamps. Normalize time zones before correlating sources.
2. Start with capture-level triage rather than dumping every packet: protocol hierarchy, endpoints, conversations, name resolution, packet lengths, expert warnings, and candidate display filters. Prefer `capinfos` and `tshark`; use `tcpdump`, Wireshark, `editcap`, `mergecap`, Scapy, or PyShark only when they add necessary evidence.
3. Isolate the smallest relevant packet set. Preserve original frame numbers and timestamps in every derived table or excerpt. For TCP, account for retransmission, out-of-order delivery, duplicate ACKs, resets, zero windows, stream reuse, and incomplete handshakes before interpreting application payloads.
4. Reassemble conversations where required and keep direction explicit. For UDP, distinguish request/response pairing from timing-based guesses. For multiplexed protocols such as HTTP/2, QUIC, WebSocket, or gRPC, preserve stream/message identity rather than treating the transport flow as one message.
5. Interpret application protocols from observable evidence:
   - DNS: query/response linkage, result codes, aliases, retries, and resolver timing.
   - HTTP: method, authority, path, status, headers, body metadata, redirects, and latency without unnecessarily exposing secrets.
   - TLS: handshake version, SNI when visible, ALPN, certificate chain, alerts, session behavior, and encrypted-data timing. Do not claim plaintext or application semantics that the capture cannot reveal.
   - Custom protocols: framing, lengths, sequence, flags, checksums, compression, encryption boundaries, and unknown fields. Hand detailed protocol reconstruction to the protocol-recovery workflow when appropriate.
6. Correlate network observations with Android evidence when relevant: package/process/UID, socket ownership, logcat timestamps, Java networking APIs, JNI/native socket calls, Frida boundary observations, and backend responses. State whether each linkage is confirmed or inferred.
7. Use reproducible filters or scripts for aggregate claims. Avoid screenshots and unbounded packet dumps as primary evidence. Cite frame numbers, stream IDs, timestamps, endpoint tuples, and generated artifact paths.
8. Deliver only artifacts needed for the question: capture inventory, endpoint/conversation tables, selected packet or stream extracts, reusable display filters or scripts, an incident timeline, findings with confidence, limitations, and focused next checks.

Captures may contain credentials, tokens, personal data, device identifiers, or private payloads. Minimize copied secrets, redact reports when full values are unnecessary, and never transmit capture contents outside the user-scoped workspace without explicit authorization.
