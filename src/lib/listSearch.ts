export function filterByQuery<T extends { name: string; slug: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase("ro");
  if (!q) return items;
  return items.filter(
    (item) => item.name.toLocaleLowerCase("ro").includes(q) || item.slug.toLocaleLowerCase("ro").includes(q)
  );
}
