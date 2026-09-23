export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function isChatNearBottom(metrics: ScrollMetrics, threshold = 48): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}

export function chatSearchTargetScrollTop(
  metrics: ScrollMetrics,
  targetViewportTop: number,
  containerViewportTop: number,
): number {
  const contextOffset = Math.min(72, Math.max(20, metrics.clientHeight * 0.18));
  const requested = metrics.scrollTop + targetViewportTop - containerViewportTop - contextOffset;
  return Math.max(0, Math.min(requested, Math.max(0, metrics.scrollHeight - metrics.clientHeight)));
}
