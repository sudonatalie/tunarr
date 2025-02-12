import { Mutex } from 'async-mutex';
import { inject, injectable } from 'inversify';
import { isNull, isString } from 'lodash-es';
import { MeiliSearch } from 'meilisearch';
import net from 'node:net';
import path from 'node:path';
import pm2 from 'pm2';
import { GlobalOptions } from '../globals.ts';
import { KEYS } from '../types/inject.ts';
import { isDefined } from '../util/index.ts';
import { Logger } from '../util/logging/LoggerFactory.ts';

export interface SearchService {}

@injectable()
export class MeilisearchService implements SearchService {
  private mutex = new Mutex();
  private started = false;
  private proc?: pm2.Proc;
  private port: number;
  #client: MeiliSearch;

  constructor(
    @inject(KEYS.Logger) private logger: Logger,
    @inject(KEYS.GlobalOptions) private globalOptions: GlobalOptions,
  ) {}

  async start() {
    const client = await this.mutex.runExclusive(async () => {
      if (this.started) {
        return this.client();
      }

      this.port = await getAvailablePort();
      this.proc = await new Promise((resolve, reject) => {
        pm2.connect((err) => {
          if (err) reject(err);

          pm2.start(
            {
              script: path.join(process.cwd(), '/bin/meilisearch'),
              name: 'meilisearch',
              args: `--http-addr localhost:${this.port} --db-path ${this.dbPath}`,
            },
            (err, proc) => {
              if (err) reject(err);
              this.logger.info(
                `Meilisearch server available on port ${this.port}`,
              );
              resolve(proc);
            },
          );
        });
      });

      this.started = true;

      return this.client();
    });

    this.logger.info('%O', await client?.getIndexes());
  }

  async stop() {
    return new Promise((resolve, reject) => {
      if (this.proc) {
        if (isDefined(this.proc.pm_id)) {
          pm2.stop(this.proc.pm_id ?? 'meilisearch', (err) => {
            if (err) reject(err);
            resolve(void 0);
          });
        } else {
          reject(new Error('Process had '));
        }
      }
    });
  }

  client() {
    if (!this.started) {
      throw new Error('Service was not started yet');
    }
    if (!this.#client) {
      this.#client = new MeiliSearch({ host: `http://localhost:${this.port}` });
    }

    return this.#client;
  }

  private get dbPath() {
    return path.join(this.globalOptions.databaseDirectory, 'data.ms');
  }
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const addr = server.address();
      server.close(() => {
        if (isString(addr) || isNull(addr)) {
          reject(new Error('Server was not open on a port'));
        } else {
          resolve(addr.port);
        }
      });
    });
  });
}
