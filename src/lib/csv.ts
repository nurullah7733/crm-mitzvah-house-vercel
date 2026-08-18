/** Turn rows into CSV text (with a BOM so Excel reads accents correctly). */
export function csvText(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "\uFEFF";
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\r\n");
  return `\uFEFF${csv}`;
}

/** Save a blob to the user's computer. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Download the given rows as a CSV file. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  downloadBlob(
    filename.endsWith(".csv") ? filename : `${filename}.csv`,
    new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }),
  );
}

export function stamp() {
  return new Date().toISOString().slice(0, 10);
}
