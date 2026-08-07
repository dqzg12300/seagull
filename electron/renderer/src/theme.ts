export type AppTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "seagull.theme";

export function resolveAppTheme(value: string | null | undefined): AppTheme {
  return value === "light" ? "light" : "dark";
}

export function nextAppTheme(theme: AppTheme): AppTheme {
  return theme === "dark" ? "light" : "dark";
}

