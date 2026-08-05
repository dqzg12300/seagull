---
name: android-version-diff
description: Compare Android APK versions and migrate prior reverse-engineering knowledge across changed manifests, resources, DEX classes and methods, obfuscated symbols, native libraries, protocols, signatures, and runtime behavior. Use for upgrade analysis, regression investigation, symbol or finding migration, patch comparison, changed-risk-surface review, and avoiding a full reanalysis of a previously studied app.
---

# Android Version Diff

Treat both APKs and prior findings as immutable inputs. Write all comparisons and migrated annotations into a new task artifact tree.

1. Confirm old/new hashes, package identity, version metadata, signing certificates, split APK context, ABIs, and available upstream reports or symbol maps.
2. Build normalized inventories for manifests, permissions, components, resources, assets, DEX/classes/methods, native libraries, endpoints, schemas, and relevant runtime behavior.
3. Remove representation noise before matching: resource IDs, decompiler formatting, compiler-generated names, relocation addresses, and known obfuscator churn. Never discard behaviorally meaningful constants or control flow.
4. Match from strongest anchors downward: stable package/component names, descriptors and JNI signatures, unique strings/constants, SDK calls, call-neighborhood fingerprints, CFG shape, native imports, and byte/function similarity.
5. Classify each item as unchanged, renamed/moved, semantically changed, added, removed, or uncertain. Attach confidence and evidence; never auto-migrate low-confidence names as fact.
6. Re-run focused static or runtime validation only for changed or uncertain paths. Reuse confirmed unchanged findings and test vectors.
7. Generate a migration map consumable by later analysis, plus a human report explaining security, protocol, fingerprinting, algorithm, and reconstruction impact.
8. Register the comparison, migration map, changed-surface inventory, validation evidence, and remaining reanalysis queue.

Read [references/diff-artifacts.md](references/diff-artifacts.md) before producing the deliverables.

For native matching, use IDA evidence and module-relative addresses. For DEX matching, prefer descriptors, call neighborhoods, constants, and behavior over obfuscated display names.
