// How figures are said: aligned tables, bytes, milliseconds, UTC times, status counts.

// Rows of cells as lines whose columns are aligned, two spaces at least between them; a row's last cell is not padded.
export function table(rows: string[][]): string[] {
  const widths = rows.reduce<number[]>((at, row) => row.map((cell, column) => Math.max(at[column] ?? 0, cell.length)), []);
  return rows.map((row) => row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!))).join('  '));
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

export const utc = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export const statusesText = (statuses: Readonly<Record<string, number>>): string =>
  Object.entries(statuses).toSorted(([a], [b]) => a.localeCompare(b)).map(([status, count]) => `${status}×${count}`).join(' ');
