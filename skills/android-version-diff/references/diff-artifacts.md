# Android version-diff artifacts

Recommended outputs:

- `version-diff/inventory-old.json` and `inventory-new.json`
- `version-diff/change-set.json`: typed additions, removals, moves, renames, semantic changes, and uncertainty
- `version-diff/symbol-migration.json`: old/new identifiers, anchor evidence, confidence, and validation state
- `version-diff/changed-surfaces.md`: manifest, permissions, endpoints, protocols, device data, crypto/signing, native libraries, and UI/resources
- `version-diff/reanalysis-queue.md`: only changed or uncertain branches, ordered by impact and validation cost
- `version-diff/report.md`: concise impact summary and reproducible verification

Every migrated symbol must include at least one stable anchor. High-confidence automatic migration should normally require two independent anchors or an exact normalized match.

Workflow design was informed by the MIT-licensed `binary-diff` skill from `zhaoxuya520/reverse-skill` (reviewed at commit `79cdde737e0bf3ce7000eb3a084d47e124d70504`). This implementation is rewritten for APK, DEX, resource, and Android native comparison.
