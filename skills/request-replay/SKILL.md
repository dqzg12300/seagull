---
name: request-replay
description: Generate and verify a mitmproxy replay addon after an Android request-signing algorithm has been recovered.
---

# Request Replay

Require a verified signing/encryption implementation before generating replay code.

1. Preserve request canonicalization order, encoding, timestamps, nonces, body serialization, and header casing where relevant.
2. Keep the recovered algorithm behind a small adapter callable by tests and the mitmproxy addon.
3. Generate deterministic fixtures from captured inputs and assert expected signature/ciphertext output.
4. The addon must scope interception to configured hosts and paths, expose no embedded credentials, and log only redacted metadata by default.
5. Advance through `GENERATE_REPLAY` to `REPORT` only after a local fixture or authorized test endpoint confirms the modified request.
