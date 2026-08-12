/**
 * The backend caps a single query at 1,000 rows. Every screen that lists the
 * whole table must page through the results, or contacts silently disappear.
 *
 * Usage:
 *   const people = await fetchAll((from, to) =>
 *     supabase.from("people").select("*").order("display_name").range(from, to),
 *   );
 */
const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * pageSize;
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    // Safety valve so a bad query can never loop forever.
    if (page > 200) break;
  }
  return rows;
}