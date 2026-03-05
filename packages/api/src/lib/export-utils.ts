export function escapeCsvValue(value: unknown): string {
  if (value == null) return "";
  const unsafeText = String(value);
  const text = /^[=+\-@]/.test(unsafeText) ? `'${unsafeText}` : unsafeText;
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function rowsToCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: Array<keyof T>,
): string {
  const header = columns.map((column) => escapeCsvValue(column)).join(",");
  const body = rows
    .map((row) => columns.map((column) => escapeCsvValue(row[column])).join(","))
    .join("\n");
  return body ? `${header}\n${body}` : header;
}
