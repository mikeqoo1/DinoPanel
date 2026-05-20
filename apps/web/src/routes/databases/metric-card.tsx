interface MetricCardProps {
  label: string;
  value: number | null | undefined;
  fmt: (v: number) => string;
}

export function MetricCard({ label, value, fmt }: MetricCardProps) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">
        {value === null || value === undefined ? '—' : fmt(value)}
      </div>
    </div>
  );
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}
