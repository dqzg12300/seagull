import type { AnalysisCategory, WorkView } from "./shared.js";

interface MutableWorkMetadataState {
  works?: WorkView[];
  analysisRequests?: Array<{ id: string; goal: string; category?: AnalysisCategory; createdAt: string }>;
  activeWorkId?: string;
  analysisCategory?: AnalysisCategory;
  updatedAt?: string;
}

export function applyWorkMetadataUpdate(
  state: MutableWorkMetadataState,
  workId: string,
  update: { title: string; category: AnalysisCategory },
  updatedAt: string,
): WorkView {
  const work = state.works?.find(item => item.id === workId);
  if (!work) throw new Error("Work item not found");
  work.title = update.title;
  work.category = update.category;
  work.updatedAt = updatedAt;
  const request = state.analysisRequests?.find(item => item.id === workId);
  if (request) request.category = update.category;
  if (state.activeWorkId === workId) state.analysisCategory = update.category;
  state.updatedAt = updatedAt;
  return work;
}
