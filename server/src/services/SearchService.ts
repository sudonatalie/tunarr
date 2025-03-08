import { FindChild } from '@tunarr/types';
import { ExternalIdType } from '@tunarr/types/schemas';
import { Mutex } from 'async-mutex';
import retry from 'async-retry';
import dayjs from 'dayjs';
import { inject, injectable } from 'inversify';
import { isEmpty, isNull, isString } from 'lodash-es';
import { EnqueuedTaskObject, MeiliSearch, Settings, Task } from 'meilisearch';
import net from 'node:net';
import path from 'node:path';
import pm2 from 'pm2';
import { ProgramType } from '../db/schema/Program.ts';
import { ProgramGroupingType } from '../db/schema/ProgramGrouping.ts';
import { GlobalOptions } from '../globals.ts';
import { KEYS } from '../types/inject.ts';
import { Episode, Movie, Persisted } from '../types/Media.js';
import { Path } from '../types/path.ts';
import { Result } from '../types/result.ts';
import { Nullable } from '../types/util.ts';
import {
  getBooleanEnvVar,
  getEnvVar,
  getNumericEnvVar,
  TUNARR_ENV_VARS,
} from '../util/env.ts';
import { isDefined, wait } from '../util/index.ts';
import { Logger } from '../util/logging/LoggerFactory.ts';

export interface SearchService {}

type FlattenArrayTypes<T> = {
  [K in keyof T]: T[K] extends Array<unknown> ? T[K][0] : T[K];
};

interface BaseDocument {
  id: string;
}

interface TunarrSearchIndex<Type extends BaseDocument> {
  name: string;
  primaryKey: string;
  filterable: Path<FlattenArrayTypes<Type>>[];
  sortable: Path<FlattenArrayTypes<Type>>[];
}

type GenericTunarrSearchIndex = {
  name: string;
  primaryKey: string;
  filterable: string[];
  sortable: string[];
};

const ProgramsIndex: TunarrSearchIndex<ProgramSearchDocument<ProgramType>> = {
  name: 'programs',
  primaryKey: 'id',
  filterable: [
    'duration',
    'externalIds.source',
    'externalIds.sourceId',
    'externalIds.id',
    'title',
    'rating',
    'originalReleaseDate',
    'originalReleaseYear',
    'externalIdsMerged',
    'grandparent.id',
    'parent.id',
  ],
  sortable: [
    'title',
    'duration',
    'originalReleaseDate',
    'originalReleaseYear',
    'index',
  ],
};

type ExternalIdSubDoc = {
  id: string;
  source: ExternalIdType;
  sourceId?: string;
};

type MergedExternalId = `${ExternalIdType}|${string}|${string}`;
type MergedGroupingExternalId<GroupingType extends ProgramGroupingType> =
  `${GroupingType}_${MergedExternalId}`;

type ProgramGroupingDenormDocument<GroupingType extends ProgramGroupingType> = {
  id: string;
  type: GroupingType;
  title: string;
  index?: number;
  year?: number;
  externalIds: ExternalIdSubDoc[];
  externalIdsMerged: MergedGroupingExternalId<GroupingType>[];
};

type ProgramParentTypeLookup = [
  [typeof ProgramType.Episode, typeof ProgramGroupingType.Season],
  [typeof ProgramType.Track, typeof ProgramGroupingType.Album],
  [typeof ProgramGroupingType.Season, typeof ProgramGroupingType.Show],
  [typeof ProgramGroupingType.Album, typeof ProgramGroupingType.Artist],
];

type StringName = {
  name: string;
};

type Actor = StringName;
type Writer = StringName;
type Director = StringName;

type ProgramSearchDocument<Type extends ProgramType = ProgramType> = {
  id: string;
  type: Type;
  externalIds: ExternalIdSubDoc[];
  externalIdsMerged: MergedExternalId[];
  duration: number;
  title: string;
  rating: Nullable<string>;
  summary: Nullable<string>;
  originalReleaseDate: Nullable<number>;
  originalReleaseYear: Nullable<number>;
  index?: number;
  parent?: ProgramGroupingDenormDocument<
    FindChild<Type, ProgramParentTypeLookup>
  >;
  grandparent?: ProgramGroupingDenormDocument<
    FindChild<FindChild<Type, ProgramParentTypeLookup>, ProgramParentTypeLookup>
  >;
  genres: StringName[];
  actors: Actor[];
  writer: Writer[];
  director: Director[];
};

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
    return await this.mutex.runExclusive(async () => {
      if (this.started) {
        return this.client();
      }

      this.port =
        getNumericEnvVar(TUNARR_ENV_VARS.SEARCH_PORT) ??
        (await getAvailablePort());

      this.proc = await new Promise((resolve, reject) => {
        pm2.connect((err) => {
          if (err) reject(err);

          const args = [
            '--http-addr',
            `localhost:${this.port}`,
            '--db-path',
            `${this.dbPath}`,
            '--no-analytics',
          ];

          const indexingRamSetting = getEnvVar(TUNARR_ENV_VARS.SEARCH_MAX_RAM);
          if (indexingRamSetting) {
            args.push('--max-indexing-memory', `${indexingRamSetting}`);
          }

          if (
            getBooleanEnvVar(
              TUNARR_ENV_VARS.DEBUG__REDUCE_SEARCH_INDEXING_MEMORY,
            )
          ) {
            args.push('--experimental-reduce-indexing-memory-usage');
          }

          pm2.start(
            {
              script: path.join(process.cwd(), '/bin/meilisearch'),
              name: 'meilisearch',
              args: args,
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

      const client = this.client();
      await retry(async () => client.health());

      return client;
    });
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

  async sync() {
    const existingIndexes = await this.client().getIndexes();

    const processes: Promise<void>[] = [];

    // Programs index
    const existingProgramsIndex = existingIndexes.results.find(
      (index) => index.uid === ProgramsIndex.name,
    );

    if (existingProgramsIndex) {
      this.logger.debug(
        'Programs index already exists. Ensuring it is up-to-date',
      );

      processes.push(this.syncIndexSettings(ProgramsIndex));
    } else {
      this.logger.debug('Creating programs index');
      const task = await this.client().createIndex(ProgramsIndex.name, {
        primaryKey: ProgramsIndex.primaryKey,
      });

      processes.push(
        this.waitForTaskResult(task.taskUid).then(() =>
          this.syncIndexSettings(ProgramsIndex),
        ),
      );
    }

    await Promise.all(processes);
  }

  async indexMovie(programs: Persisted<Movie>[]) {
    if (isEmpty(programs)) {
      return;
    }

    await this.client()
      .index<ProgramSearchDocument<'movie' | 'episode'>>(ProgramsIndex.name)
      .addDocuments(
        programs.map((p) => this.convertProgramToSearchDocument(p)),
      );
  }

  private convertProgramToSearchDocument(
    program: Persisted<Movie> | Persisted<Episode>,
  ): ProgramSearchDocument<(typeof program)['type']> {
    const validEids = program.identifiers.map((eid) => ({
      id: eid.id,
      source: eid.type,
      sourceId: eid.sourceId ?? undefined,
    }));

    const mergedExternalIds = validEids.map(
      (eid) =>
        `${eid.source}|${eid.sourceId ?? ''}|${eid.id}` satisfies MergedExternalId,
    );

    const document: ProgramSearchDocument<typeof program.type> = {
      id: program.uuid,
      duration: +program.mediaItem.duration,
      externalIds: validEids,
      externalIdsMerged: mergedExternalIds,
      originalReleaseDate: Result.attempt(() => dayjs(program.releaseDate))
        .map((_) => _.valueOf())
        .getOrElse(() => null),
      originalReleaseYear: program.year,
      summary: program.summary,
      title: program.title,
      type: program.type,
      index: program.type === 'episode' ? program.episodeNumber : undefined,
      rating:
        program.type === 'movie' ? program.rating : program.season.show.rating,
      genres: program.genres,
      actors: program.actors,
      director: program.directors,
      writer: program.writers,
    };

    if (program.type === 'episode') {
      const seasonEids = program.season.identifiers.map((eid) => ({
        id: eid.id,
        source: eid.type,
        sourceId: eid.sourceId ?? undefined,
      }));

      const showEids = program.season.show.identifiers.map((eid) => ({
        id: eid.id,
        source: eid.type,
        sourceId: eid.sourceId ?? undefined,
      }));

      document.parent = {
        id: program.season.uuid,
        externalIds: seasonEids,
        type: program.season.type,
        externalIdsMerged: seasonEids.map(
          (eid) =>
            `${program.season.type}_${eid.source}|${eid.sourceId ?? ''}|${eid.id}` satisfies MergedGroupingExternalId<'season'>,
        ),
        title: program.season.title,
        year: program.season.year ?? undefined,
      } satisfies ProgramGroupingDenormDocument<
        typeof ProgramGroupingType.Season
      >;

      document.grandparent = {
        id: program.season.show.uuid,
        type: program.season.show.type,
        externalIds: showEids,
        externalIdsMerged: showEids.map(
          (eid) =>
            `${program.season.show.type}_${eid.source}|${eid.sourceId ?? ''}|${eid.id}` satisfies MergedGroupingExternalId<'show'>,
        ),
        title: program.season.show.title,
        year: program.season.show.year ?? undefined,
      };
    }

    return document;
  }

  private async syncIndexSettings(index: GenericTunarrSearchIndex) {
    const programsIndex = this.client().index(index.name);

    const settings: Settings = {
      filterableAttributes: index.filterable,
      sortableAttributes: index.sortable,
    };

    const task = await programsIndex.updateSettings(settings);

    return this.waitForTaskResult(task.taskUid);
  }

  private async waitForTaskResult(
    taskId: number,
    canceledIsOk: boolean = false,
  ) {
    let status: EnqueuedTaskObject['status'] = 'enqueued';
    let task: Task;
    do {
      task = await this.client().getTask(taskId);
      status = task.status;
      await wait(500);
    } while (
      status !== 'canceled' &&
      status !== 'failed' &&
      status !== 'succeeded'
    );

    if (status === 'succeeded' || (canceledIsOk && status === 'canceled')) {
      return;
    }

    throw new Error(
      `Task ${taskId} ended with status ${status}: ${task.error?.code} ${task?.error?.message}`,
    );
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
