import { head, round } from 'lodash-es';
import type { ProgramConverter } from '../../db/converters/ProgramConverter.ts';
import type { IProgramDB } from '../../db/interfaces/IProgramDB.ts';
import type { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type { NewMovieProgram } from '../../db/schema/derivedTypes.js';
import type { MediaSourceType } from '../../db/schema/MediaSource.ts';
import { ProgramType } from '../../db/schema/Program.ts';
import { isMovieProgram } from '../../db/schema/schemaTypeGuards.ts';
import type { Movie } from '../../types/Media.ts';
import { Result } from '../../types/result.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import type { EntityMutex } from '../EntityMutex.ts';
import type { MeilisearchService } from '../SearchService.ts';
import type { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import type { ScanContext } from './MediaSourceScanner.ts';
import { MediaSourceScanner } from './MediaSourceScanner.ts';

export abstract class MediaSourceMovieLibraryScanner<
  MediaSourceTypeT extends MediaSourceType,
  ApiClientTypeT,
  MovieT extends Movie = Movie,
> extends MediaSourceScanner<'movies', MediaSourceTypeT, ApiClientTypeT> {
  readonly type = 'movies';

  constructor(
    logger: Logger,
    mediaSourceDB: MediaSourceDB,
    entityMutex: EntityMutex,
    protected programDB: IProgramDB,
    protected mediaSourceProgressService: MediaSourceProgressService,
    private searchService: MeilisearchService,
    protected programConverter: ProgramConverter,
  ) {
    super(logger, mediaSourceDB, entityMutex);
  }

  protected async scanInternal(
    context: ScanContext<ApiClientTypeT>,
  ): Promise<void> {
    this.mediaSourceProgressService.scanStarted(context.library.uuid);

    const { library, force } = context;
    const existingPrograms =
      await this.programDB.getProgramCanonicalIdsForMediaSource(
        library.uuid,
        ProgramType.Movie,
      );

    const seenMovieIds = new Set<string>();

    const totalSize = await this.getLibrarySize(library.externalKey, context);

    for await (const movie of this.getLibraryContents(
      library.externalKey,
      context,
    )) {
      const canonicalId = this.getCanonicalId(movie);
      const externalKey = this.getExternalKey(movie);

      seenMovieIds.add(externalKey);

      const processedAmount = round(seenMovieIds.size / totalSize, 2);

      this.mediaSourceProgressService.scanProgress(
        library.uuid,
        processedAmount,
      );

      if (
        !force &&
        existingPrograms[externalKey] &&
        existingPrograms[externalKey].canonicalId === canonicalId
      ) {
        this.logger.debug(
          'Found an unchanged program: rating key = %s, program iD = %s',
          externalKey,
          existingPrograms[externalKey].uuid,
        );
        continue;
      }

      const result = await this.scanMovie(context, movie).then((result) =>
        result.flatMapAsync((newMovie) => {
          return Result.attemptAsync(() =>
            this.programDB
              .upsertPrograms([newMovie])
              .then((_) => _.filter(isMovieProgram)),
          );
        }),
      );

      if (result.isFailure()) {
        this.logger.warn(
          result.error,
          'Error while processing movie (%O)',
          movie,
        );

        continue;
      }

      const dbMovie = head(result.get());
      if (dbMovie) {
        this.logger.debug(
          'Upserted movie %s (ID = %s)',
          dbMovie?.title,
          dbMovie?.uuid,
        );

        await this.searchService.indexMovie([{ ...movie, uuid: dbMovie.uuid }]);
      }
    }
  }

  protected abstract scanMovie(
    context: ScanContext<ApiClientTypeT>,
    incomingMovie: MovieT,
  ): Promise<Result<NewMovieProgram>>;

  protected abstract getLibrarySize(
    libraryKey: string,
    context: ScanContext<ApiClientTypeT>,
  ): Promise<number>;

  protected abstract getLibraryContents(
    libraryKey: string,
    context: ScanContext<ApiClientTypeT>,
  ): AsyncIterable<MovieT>;

  protected abstract getCanonicalId(entity: MovieT): string;

  protected abstract getExternalKey(entity: MovieT): string;
}
