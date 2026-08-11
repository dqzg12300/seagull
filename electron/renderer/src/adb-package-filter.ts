export interface FilterableAdbPackage {
  packageName: string;
  serial: string;
  model?: string;
}

export function filterAdbPackages<T extends FilterableAdbPackage>(packages: T[], value: string): T[] {
  const query = value.trim().toLocaleLowerCase();
  if (!query) return packages;
  return packages.filter(item => `${item.packageName} ${item.model ?? ""} ${item.serial}`.toLocaleLowerCase().includes(query));
}
