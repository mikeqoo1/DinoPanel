import { Injectable } from '@nestjs/common';
import type { DbEngine } from '@dinopanel/shared';
import type { BackupDriver } from './backup-driver';
import { MariadbBackupDriver } from './drivers/mariadb.backup-driver';
import { MongodbBackupDriver } from './drivers/mongodb.backup-driver';
import { MysqlBackupDriver } from './drivers/mysql.backup-driver';
import { PostgresqlBackupDriver } from './drivers/postgresql.backup-driver';
import { RedisBackupDriver } from './drivers/redis.backup-driver';

/**
 * Mirror of DbEngineRegistry — constructor-injected map of
 * engine → backup driver. Adding a new engine = new driver + new
 * constructor param + new map entry. No registration boilerplate.
 */
@Injectable()
export class BackupDriverRegistry {
  private readonly byEngine: ReadonlyMap<DbEngine, BackupDriver>;

  constructor(
    mysql: MysqlBackupDriver,
    mariadb: MariadbBackupDriver,
    postgresql: PostgresqlBackupDriver,
    redis: RedisBackupDriver,
    mongodb: MongodbBackupDriver,
  ) {
    this.byEngine = new Map<DbEngine, BackupDriver>([
      ['mysql', mysql],
      ['mariadb', mariadb],
      ['postgresql', postgresql],
      ['redis', redis],
      ['mongodb', mongodb],
    ]);
  }

  get(engine: DbEngine): BackupDriver {
    const driver = this.byEngine.get(engine);
    if (!driver) {
      // dbEngineSchema is closed → only reachable via direct misuse.
      // Throw at the boundary to enforce the contract.
      throw new Error(`No backup driver registered for engine: ${engine}`);
    }
    return driver;
  }

  engines(): DbEngine[] {
    return Array.from(this.byEngine.keys());
  }
}
