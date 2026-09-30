// Display only: integer paisa in, "৳68.00" out. No floating point, so nothing drifts.
export function formatPaisa(paisa: number): string {
  const sign = paisa < 0 ? "-" : "";
  const abs = Math.abs(paisa);
  const taka = Math.trunc(abs / 100);
  const rest = abs % 100;
  return `${sign}৳${taka}.${String(rest).padStart(2, "0")}`;
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
