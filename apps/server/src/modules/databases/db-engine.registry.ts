import { Injectable } from '@nestjs/common';
import type { DbEngine } from '@dinopanel/shared';
import type { DbEngineDriver } from './engines/driver.interface';
import { MariadbDriver } from './engines/mariadb.driver';
import { MongoDriver } from './engines/mongo.driver';
import { MysqlDriver } from './engines/mysql.driver';
import { PostgresDriver } from './engines/postgres.driver';
import { RedisDriver } from './engines/redis.driver';

/**
 * Constructor-injected map of engine → driver. Adding a new engine in
 * a future release means: new driver class + new constructor param +
 * new entry in `byEngine`. No registration boilerplate elsewhere.
 */
@Injectable()
export class DbEngineRegistry {
  private readonly byEngine: ReadonlyMap<DbEngine, DbEngineDriver>;

  constructor(
    mysql: MysqlDriver,
    mariadb: MariadbDriver,
    postgres: PostgresDriver,
    redis: RedisDriver,
    mongo: MongoDriver,
  ) {
    this.byEngine = new Map<DbEngine, DbEngineDriver>([
      ['mysql', mysql],
      ['mariadb', mariadb],
      ['postgresql', postgres],
      ['redis', redis],
      ['mongodb', mongo],
    ]);
  }

  get(engine: DbEngine): DbEngineDriver {
    const driver = this.byEngine.get(engine);
    if (!driver) {
      // dbEngineSchema is closed → this is only reachable via direct
      // misuse (e.g. test that passes a bad string). Keep the throw
      // anyway so the contract is enforced at the registry boundary.
      throw new Error(`No driver registered for engine: ${engine}`);
    }
    return driver;
  }

  engines(): DbEngine[] {
    return Array.from(this.byEngine.keys());
  }
}
