# Runtime diagnostic artifacts

Recommended outputs:

- `diagnostics/device-snapshot.json`: serial, build, ABI, package/version, process, activity, permissions, and relevant environment.
- `diagnostics/reproduction.md`: preconditions, exact actions, expected/observed results, timestamps, and reproducibility rate.
- `diagnostics/logcat.txt`: narrowly scoped raw log evidence with the collection command recorded separately.
- `diagnostics/crash/`: exception, ANR traces, tombstone, backtrace, symbolization, or dumpsys output as applicable.
- `diagnostics/timeline.json`: normalized timestamp, source, process/thread, event, code anchor, and evidence path.
- `diagnostics/hypotheses.md`: ranked candidates, supporting/contradicting evidence, and discriminating checks.
- `diagnostics/root-cause.md`: confirmed failure path, environmental dependencies, limitations, remediation direction, and verification.

Resolution requires a reproducible symptom or clearly documented intermittency, a correlated runtime-to-code path, and a focused check that distinguishes the selected root cause from plausible alternatives.
