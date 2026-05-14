import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

interface MetricChartProps {
  data: number[];
  color?: string;
  yMax?: number;
  format?: (v: number) => string;
  height?: number;
}

export function MetricChart({ data, color = 'var(--color-chart-1)', yMax, format, height = 80 }: MetricChartProps) {
  const rows = data.map((v, i) => ({ i, v }));
  const id = `grad-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={[0, yMax ?? 'auto']} />
        <Tooltip
          contentStyle={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            fontSize: 12,
            padding: '4px 8px',
          }}
          labelStyle={{ display: 'none' }}
          formatter={(v: number) => [format ? format(v) : v.toFixed(1), '']}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${id})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
