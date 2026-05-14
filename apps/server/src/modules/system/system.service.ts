import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import * as si from 'systeminformation';
import { Logger } from 'nestjs-pino';
import { Subject } from 'rxjs';
import type { MetricsSnapshot, SystemInfo } from '@dinopanel/shared';

const POLL_INTERVAL_MS = 1000;

@Injectable()
export class SystemService implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private lastSnapshot: MetricsSnapshot | null = null;
  private lastNet: { rx: number; tx: number; ts: number } | null = null;
  private lastDiskIo: { read: number; write: number; ts: number } | null = null;
  private cachedInfo: SystemInfo | null = null;
  readonly metrics$ = new Subject<MetricsSnapshot>();

  constructor(private readonly logger: Logger) {}

  async onModuleInit() {
    this.timer = setInterval(() => {
      this.poll().catch((err) => this.logger.warn({ err }, 'metrics poll failed'));
    }, POLL_INTERVAL_MS);
    // prime
    this.poll().catch(() => undefined);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.metrics$.complete();
  }

  getLatest(): MetricsSnapshot | null {
    return this.lastSnapshot;
  }

  async getInfo(): Promise<SystemInfo> {
    if (this.cachedInfo) return this.cachedInfo;
    const [osInfo, cpu, mem, time, net] = await Promise.all([
      si.osInfo(),
      si.cpu(),
      si.mem(),
      si.time(),
      si.networkInterfaces(),
    ]);

    const ips = (Array.isArray(net) ? net : [net])
      .filter((n) => !n.internal && (n.ip4 || n.ip6))
      .map((n) => ({
        iface: n.iface,
        ipv4: n.ip4 || undefined,
        ipv6: n.ip6 || undefined,
        mac: n.mac || undefined,
      }));

    this.cachedInfo = {
      hostname: osInfo.hostname,
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        kernel: osInfo.kernel,
        arch: osInfo.arch,
      },
      cpu: {
        model: `${cpu.manufacturer} ${cpu.brand}`.trim(),
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speed: cpu.speed,
      },
      memTotal: mem.total,
      bootTime: Math.floor((Date.now() - time.uptime * 1000) / 1000),
      uptime: time.uptime,
      ips,
    };
    return this.cachedInfo;
  }

  private async poll(): Promise<void> {
    const ts = Date.now();
    const [load, mem, fsSize, netStats, diskIo] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.disksIO().catch(() => null),
    ]);

    const netAgg = (Array.isArray(netStats) ? netStats : [netStats]).reduce(
      (acc, n) => {
        acc.rx += n.rx_bytes;
        acc.tx += n.tx_bytes;
        return acc;
      },
      { rx: 0, tx: 0 },
    );

    let rxRate = 0;
    let txRate = 0;
    if (this.lastNet) {
      const dt = (ts - this.lastNet.ts) / 1000;
      if (dt > 0) {
        rxRate = Math.max(0, (netAgg.rx - this.lastNet.rx) / dt);
        txRate = Math.max(0, (netAgg.tx - this.lastNet.tx) / dt);
      }
    }
    this.lastNet = { rx: netAgg.rx, tx: netAgg.tx, ts };

    let readRate = 0;
    let writeRate = 0;
    if (diskIo && this.lastDiskIo) {
      const dt = (ts - this.lastDiskIo.ts) / 1000;
      if (dt > 0) {
        readRate = Math.max(0, (diskIo.rIO_sec ?? 0) * 512);
        writeRate = Math.max(0, (diskIo.wIO_sec ?? 0) * 512);
      }
    }
    if (diskIo) this.lastDiskIo = { read: diskIo.rIO ?? 0, write: diskIo.wIO ?? 0, ts };

    const snapshot: MetricsSnapshot = {
      ts,
      cpu: {
        usage: Number(load.currentLoad.toFixed(2)),
        loadAvg: [load.avgLoad ?? 0, load.avgLoad ?? 0, load.avgLoad ?? 0],
      },
      mem: {
        used: mem.active,
        total: mem.total,
        free: mem.available,
        swapUsed: mem.swapused,
        swapTotal: mem.swaptotal,
      },
      disks: fsSize
        .filter((d) => !d.mount.startsWith('/snap') && !d.mount.startsWith('/run'))
        .map((d) => ({ mount: d.mount, used: d.used, total: d.size })),
      net: { rx: netAgg.rx, tx: netAgg.tx, rxRate, txRate },
      diskIo: { readRate, writeRate },
    };

    this.lastSnapshot = snapshot;
    this.metrics$.next(snapshot);
  }
}
