/**
 * A tiny stand-in for the Supabase client: enough of the query builder to test
 * the logic that decides what to write, without a network or a database.
 */
export type Rows = Record<string, Record<string, unknown>[]>;

type Filter = { column: string; value: unknown; op: "eq" | "is" | "gte" | "lte" };

export function createFakeSupabase(initial: Rows) {
  const tables: Rows = JSON.parse(JSON.stringify(initial));
  const writes: {
    table: string;
    op: "insert" | "update" | "delete";
    payload: Record<string, unknown>;
  }[] = [];

  function matches(row: Record<string, unknown>, filters: Filter[]) {
    return filters.every((f) => {
      const v = row[f.column];
      if (f.op === "eq") return v === f.value;
      if (f.op === "is") return (v ?? null) === (f.value ?? null);
      if (f.op === "gte") return String(v) >= String(f.value);
      return String(v) <= String(f.value);
    });
  }

  function from(table: string) {
    const filters: Filter[] = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Record<string, unknown> = {};
    let limit: number | null = null;

    const run = () => {
      tables[table] ??= [];
      const rows = tables[table]!;
      if (mode === "insert") {
        rows.push({ id: `${table}-${rows.length + 1}`, ...payload });
        writes.push({ table, op: "insert", payload });
        return { data: null, error: null };
      }
      if (mode === "update") {
        for (const row of rows.filter((r) => matches(r, filters))) Object.assign(row, payload);
        writes.push({ table, op: "update", payload });
        return { data: null, error: null };
      }
      if (mode === "delete") {
        tables[table] = rows.filter((r) => !matches(r, filters));
        writes.push({ table, op: "delete", payload: {} });
        return { data: null, error: null };
      }
      const hits = rows.filter((r) => matches(r, filters));
      return { data: limit === null ? hits : hits.slice(0, limit), error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      insert: (p: Record<string, unknown>) => {
        mode = "insert";
        payload = p;
        return builder;
      },
      update: (p: Record<string, unknown>) => {
        mode = "update";
        payload = p;
        return builder;
      },
      delete: () => {
        mode = "delete";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push({ column, value, op: "eq" });
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push({ column, value, op: "is" });
        return builder;
      },
      gte: (column: string, value: unknown) => {
        filters.push({ column, value, op: "gte" });
        return builder;
      },
      lte: (column: string, value: unknown) => {
        filters.push({ column, value, op: "lte" });
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      maybeSingle: () => {
        limit = 1;
        const r = run() as { data: Record<string, unknown>[] };
        return Promise.resolve({ data: r.data[0] ?? null, error: null });
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder as never;
  }

  return { client: { from } as never, tables, writes };
}
