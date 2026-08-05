export type GradleSource = "wrapper" | "cache" | "path";

export interface GradleDistributionInfo {
  distribution: string;
  versionDirectory: string;
}

export function decodeProcessText(value: string | Buffer | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const utf8 = new TextDecoder("utf-8").decode(value);
  if (!utf8.includes("\uFFFD")) return utf8;
  const gb18030 = new TextDecoder("gb18030").decode(value);
  const invalid = (text: string) => [...text].filter(character => character === "\uFFFD").length;
  return invalid(gb18030) < invalid(utf8) ? gb18030 : utf8;
}

export function parseGradleDistributionProperties(properties: string): GradleDistributionInfo | undefined {
  const distributionUrl = /^distributionUrl=(.+)$/m.exec(properties)?.[1]?.trim().replace(/\\:/g, ":");
  const archive = distributionUrl?.split(/[\\/]/).pop()?.split("?")[0];
  const distribution = archive?.replace(/\.zip$/i, "");
  const versionDirectory = distribution?.replace(/-(?:bin|all)$/i, "");
  return distribution && versionDirectory ? { distribution, versionDirectory } : undefined;
}

export function chooseGradleScript(input: { wrapper?: string; wrapperJarExists: boolean; cached?: string; global?: string }): { script: string; source: GradleSource } | undefined {
  if (input.wrapper && input.wrapperJarExists) return { script: input.wrapper, source: "wrapper" };
  if (input.cached) return { script: input.cached, source: "cache" };
  if (input.global) return { script: input.global, source: "path" };
  return undefined;
}

export function windowsBatchCommand(script: string, args: string[]): string {
  if (/[\r\n]/.test(script) || args.some(argument => /[\r\n]/.test(argument))) throw new Error("Invalid newline in Windows batch command");
  const quote = (value: string) => /^[a-zA-Z0-9._:/=-]+$/.test(value) ? value : `"${value.replaceAll('"', '""')}"`;
  const command = [`"${script.replaceAll('"', '""')}"`, ...args.map(quote)].join(" ");
  return `"${command}"`;
}
