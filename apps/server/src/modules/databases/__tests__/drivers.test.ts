import { describe, it, expect } from 'vitest';
import type { DbEngineDriver } from '../engines/driver.interface';
import { MariadbDriver } from '../engines/mariadb.driver';
import { MongoDriver } from '../engines/mongo.driver';
import { MysqlDriver } from '../engines/mysql.driver';
import { PostgresDriver } from '../engines/postgres.driver';
import { RedisDriver } from '../engines/redis.driver';
import { DbEngineRegistry } from '../db-engine.registry';

// Per spec.md §verification-gates: 10 driver-matrix cases (2 per engine × 5).
// Phase 1 ships the pure-data parts (defaults + PromQL bundles); the
// buildContainerSpec + healthProbe paths throw NOT_IMPLEMENTED_YET (phase: 2)
// — those will be black-box golden tests once Phase 2 lands.

describe('MysqlDriver', () => {
  const d: DbEngineDriver = new MysqlDriver();

  it('engine constants match spec.md defaults', () => {
    expect(d.engine).toBe('mysql');
    expect(d.defaultImage).toBe('mysql:8.4');
    expect(d.defaultPort).toBe(3306);
    expect(d.dataDirInContainer).toBe('/var/lib/mysql');
    expect(d.dataSubdir).toBeUndefined();
  });

  it('promqlBundle uses mysqld_exporter metric names with service_name filter', () => {
    const bundle = d.promqlBundle('dinopanel-mysql-shop');
    expect(bundle.qps).toContain('mysql_global_status_questions');
    expect(bundle.qps).toContain('service_name="dinopanel-mysql-shop"');
    expect(bundle.connections).toContain('mysql_global_status_threads_connected');
    expect(bundle.uptimeSeconds).toContain('mysql_global_status_uptime');
    expect(bundle.replicationLagSeconds).toContain('mysql_slave_lag_seconds');
  });
});

describe('MariadbDriver', () => {
  const d: DbEngineDriver = new MariadbDriver();

  it('engine constants match spec.md defaults', () => {
    expect(d.engine).toBe('mariadb');
    expect(d.defaultImage).toBe('mariadb:11.4');
    expect(d.defaultPort).toBe(3306);
    expect(d.dataDirInContainer).toBe('/var/lib/mysql');
    expect(d.dataSubdir).toBeUndefined();
  });

  it('promqlBundle reuses mysqld_exporter shape (matches MysqlDriver intent)', () => {
    const bundle = d.promqlBundle('dinopanel-mariadb-cms');
    // MariaDB PMM exporter is mysqld_exporter — bundle should match MySQL
    // pattern for every metric.
    expect(bundle.qps).toContain('mysql_global_status_questions');
    expect(bundle.connections).toContain('mysql_global_status_threads_connected');
    expect(bundle.uptimeSeconds).toContain('mysql_global_status_uptime');
    expect(bundle.replicationLagSeconds).toContain('mysql_slave_lag_seconds');
  });
});

describe('PostgresDriver', () => {
  const d: DbEngineDriver = new PostgresDriver();

  it('engine constants — postgres:18 default + cross-version PGDATA layout', () => {
    expect(d.engine).toBe('postgresql');
    // 18 default — bumped during v0.4 smoke when PostgreSQL 18 released
    // (2025-09) AND the official image moved VOLUME up to
    // /var/lib/postgresql. The driver binds at that location for
    // forward compat; PGDATA env keeps the layout stable across
    // upgrades.
    expect(d.defaultImage).toBe('postgres:18');
    expect(d.defaultPort).toBe(5432);
    expect(d.dataDirInContainer).toBe('/var/lib/postgresql');
    expect(d.dataSubdir).toBe('pgdata');
  });

  it('promqlBundle uses pg_stat metric names', () => {
    const bundle = d.promqlBundle('dinopanel-postgresql-app');
    expect(bundle.qps).toContain('pg_stat_database_xact_commit');
    expect(bundle.connections).toContain('pg_stat_database_numbackends');
    expect(bundle.uptimeSeconds).toContain('pg_postmaster_start_time_seconds');
    expect(bundle.replicationLagSeconds).toContain('pg_replication_lag');
  });
});

describe('RedisDriver', () => {
  const d: DbEngineDriver = new RedisDriver();

  it('engine constants match spec.md defaults', () => {
    expect(d.engine).toBe('redis');
    expect(d.defaultImage).toBe('redis:7.4-alpine');
    expect(d.defaultPort).toBe(6379);
    expect(d.dataDirInContainer).toBe('/data');
    expect(d.dataSubdir).toBeUndefined();
  });

  it('promqlBundle uses redis_exporter metric names', () => {
    const bundle = d.promqlBundle('dinopanel-redis-cache');
    expect(bundle.qps).toContain('redis_commands_processed_total');
    expect(bundle.connections).toContain('redis_connected_clients');
    expect(bundle.uptimeSeconds).toContain('redis_uptime_in_seconds');
    // Empty vector for standalone — PMM client maps that to null.
    expect(bundle.replicationLagSeconds).toContain('redis_connected_slave_lag_seconds');
  });
});

describe('MongoDriver', () => {
  const d: DbEngineDriver = new MongoDriver();

  it('engine constants match spec.md defaults', () => {
    expect(d.engine).toBe('mongodb');
    expect(d.defaultImage).toBe('mongo:7.0');
    expect(d.defaultPort).toBe(27017);
    expect(d.dataDirInContainer).toBe('/data/db');
    expect(d.dataSubdir).toBeUndefined();
  });

  it('promqlBundle uses mongodb_exporter metric names with state filter on connections', () => {
    const bundle = d.promqlBundle('dinopanel-mongodb-events');
    expect(bundle.qps).toContain('mongodb_op_counters_total');
    expect(bundle.connections).toContain('mongodb_connections');
    expect(bundle.connections).toContain('state="current"');
    expect(bundle.uptimeSeconds).toContain('mongodb_instance_uptime_seconds');
    expect(bundle.replicationLagSeconds).toContain(
      'mongodb_mongod_replset_member_replication_lag',
    );
  });
});

describe('DbEngineRegistry', () => {
  const registry = new DbEngineRegistry(
    new MysqlDriver(),
    new MariadbDriver(),
    new PostgresDriver(),
    new RedisDriver(),
    new MongoDriver(),
  );

  it('exposes all five engines', () => {
    expect(new Set(registry.engines())).toEqual(
      new Set(['mysql', 'mariadb', 'postgresql', 'redis', 'mongodb']),
    );
  });

  it('returns the matching driver for each engine', () => {
    expect(registry.get('mysql').engine).toBe('mysql');
    expect(registry.get('postgresql').engine).toBe('postgresql');
    expect(registry.get('mongodb').engine).toBe('mongodb');
  });
});
