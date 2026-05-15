import { z } from 'zod';

export const systemInfoSchema = z.object({
  hostname: z.string(),
  os: z.object({
    platform: z.string(),
    distro: z.string(),
    release: z.string(),
    kernel: z.string(),
    arch: z.string(),
  }),
  cpu: z.object({
    model: z.string(),
    cores: z.number().int(),
    physicalCores: z.number().int(),
    speed: z.number(),
  }),
  memTotal: z.number().int().nonnegative(),
  bootTime: z.number().int(),
  uptime: z.number(),
  ips: z.array(
    z.object({
      iface: z.string(),
      ipv4: z.string().optional(),
      ipv6: z.string().optional(),
      mac: z.string().optional(),
    }),
  ),
});
export type SystemInfo = z.infer<typeof systemInfoSchema>;

export const processInfoSchema = z.object({
  hostname: z.string(),
  uid: z.number().int(),
  gid: z.number().int(),
  username: z.string(),
  home: z.string(),
  isRoot: z.boolean(),
  dinopanelVersion: z.string(),
  platform: z.string(),
  nodeVersion: z.string(),
});
export type ProcessInfo = z.infer<typeof processInfoSchema>;

export const metricsSnapshotSchema = z.object({
  ts: z.number().int(),
  cpu: z.object({
    usage: z.number(),
    loadAvg: z.tuple([z.number(), z.number(), z.number()]),
  }),
  mem: z.object({
    used: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    free: z.number().int().nonnegative(),
    swapUsed: z.number().int().nonnegative(),
    swapTotal: z.number().int().nonnegative(),
  }),
  disks: z.array(
    z.object({
      mount: z.string(),
      used: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
  ),
  net: z.object({
    rx: z.number().int().nonnegative(),
    tx: z.number().int().nonnegative(),
    rxRate: z.number().nonnegative(),
    txRate: z.number().nonnegative(),
  }),
  diskIo: z.object({
    readRate: z.number().nonnegative(),
    writeRate: z.number().nonnegative(),
  }),
});
export type MetricsSnapshot = z.infer<typeof metricsSnapshotSchema>;
