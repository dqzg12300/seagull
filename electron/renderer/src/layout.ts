export const DEFAULT_AGENT_PANEL_WIDTH = 350;
export const MIN_AGENT_PANEL_WIDTH = 320;

export function clampAgentPanelWidth(requestedWidth: number, viewportWidth: number): number {
  const sidebarWidth = viewportWidth <= 1250 ? 185 : 210;
  const minimumMainWidth = viewportWidth <= 1100 ? 300 : 380;
  const maximumWidth = Math.max(MIN_AGENT_PANEL_WIDTH, viewportWidth - sidebarWidth - minimumMainWidth);
  const safeWidth = Number.isFinite(requestedWidth) ? requestedWidth : DEFAULT_AGENT_PANEL_WIDTH;
  return Math.round(Math.min(maximumWidth, Math.max(MIN_AGENT_PANEL_WIDTH, safeWidth)));
}
