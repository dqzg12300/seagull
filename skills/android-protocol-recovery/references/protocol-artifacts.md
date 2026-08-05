# Protocol recovery artifacts

Produce only artifacts relevant to the selected transport:

- `protocol/spec.md`: framing, directions, message types, field table, state transitions, transforms, and confidence.
- `protocol/samples/`: immutable raw and decoded sample pairs with timestamps and hashes.
- `protocol/parser.*` and `protocol/encoder.*`: bounds-checked deterministic implementations.
- `protocol/tests/`: parse fixtures, malformed-frame tests, round-trip tests, and known vectors.
- `protocol/field-provenance.md`: field, source API or function, transformations, sink, evidence, and confidence.
- `protocol/verification.md`: exact commands, sample identifiers, matches, mismatches, and limitations.

Acceptance requires multiple samples, explicit byte order and encoding, preserved unknown fields, and a documented stream reassembly rule where the transport is not message framed.

Workflow design was informed by the MIT-licensed `protocol-reverse` skill from `zhaoxuya520/reverse-skill` (reviewed at commit `79cdde737e0bf3ce7000eb3a084d47e124d70504`). This implementation is rewritten for Seagull's Android case and MCP model.
