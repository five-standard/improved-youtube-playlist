export function videoSortFn(a, b) {
  if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
  if (a.sortOrder != null) return -1;
  if (b.sortOrder != null) return 1;
  return (b.savedAt ?? 0) - (a.savedAt ?? 0);
}
