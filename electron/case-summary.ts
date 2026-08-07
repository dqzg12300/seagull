import type { AnalysisCategory, CaseWorkSummary, WorkView } from "./shared.js";

export function orderedCaseWorkSummaries(
  works: Array<Pick<WorkView, "id" | "title" | "category" | "createdAt">> | undefined,
  fallback?: { category?: AnalysisCategory; createdAt?: string },
): CaseWorkSummary[] {
  const source = works?.length
    ? works.map((work, index) => ({ ...work, index }))
    : fallback?.category
      ? [{ id: "legacy-work", title: "", category: fallback.category, createdAt: fallback.createdAt ?? "", index: 0 }]
      : [];

  return source
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt);
      const rightTime = Date.parse(right.createdAt);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
      if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(leftTime) ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ index: _index, ...work }) => work);
}
