import type { IProgramDB } from '../../db/interfaces/IProgramDB.ts';
import type { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type {
  MediaSourceLibrary,
  MediaSourceType,
} from '../../db/schema/MediaSource.ts';
import { ProgramType } from '../../db/schema/Program.ts';
import { ProgramGroupingType } from '../../db/schema/ProgramGrouping.ts';
import type {
  NewProgramGroupingWithExternalIds,
  NewProgramWithExternalIds,
  ProgramGroupingWithExternalIds,
} from '../../db/schema/derivedTypes.js';
import { Result } from '../../types/result.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import type { EntityMutex } from '../EntityMutex.ts';
import type { ScanContext } from './MediaSourceScanner.ts';
import { MediaSourceScanner } from './MediaSourceScanner.ts';

export abstract class MediaSourceTvShowLibraryScanner<
  MediaSourceTypeT extends MediaSourceType,
  ApiClientTypeT,
  ShowT,
  SeasonT,
  EpisodeT,
> extends MediaSourceScanner<'shows', MediaSourceTypeT, ApiClientTypeT> {
  readonly type = 'shows' as const;

  constructor(
    logger: Logger,
    mediaSourceDB: MediaSourceDB,
    entityMutex: EntityMutex,
    protected programDB: IProgramDB,
  ) {
    super(logger, mediaSourceDB, entityMutex);
  }

  protected async scanInternal(
    context: ScanContext<ApiClientTypeT>,
  ): Promise<void> {
    const { library, mediaSource } = context;
    const existingShows = this.programDB.getProgramGroupingCanonicalIds(
      library.uuid,
      ProgramGroupingType.Show,
      this.mediaSourceType,
    );

    for await (const show of this.getTvShowLibraryContents(
      library.externalKey,
      context,
    )) {
      // const canonicalId = this.getCanonicalId(show);

      // Get full metadata?
      const dao = this.mintShowDao(show, library);

      const upsertResult = await Result.attemptAsync(() =>
        this.programDB.getOrInsertProgramGrouping(dao, {
          externalKey: this.getEntityExternalKey(show),
          externalSourceId: mediaSource.name,
          sourceType: this.mediaSourceType,
        }),
      );

      if (upsertResult.isFailure()) {
        this.logger.warn(upsertResult.error);
        continue;
      }

      const upsertedShow = upsertResult.get().entity;

      const scanSeasonsResult = await this.scanSeasons(
        show,
        upsertedShow,
        context,
      );

      if (scanSeasonsResult.isFailure()) {
        this.logger.warn(scanSeasonsResult.error);
      }
    }
  }

  protected async scanSeasons(
    show: ShowT,
    dbShow: ProgramGroupingWithExternalIds,
    scanContext: ScanContext<ApiClientTypeT>,
  ): Promise<Result<void>> {
    return Result.attemptAsync(async () => {
      const { mediaSource, library } = scanContext;
      const existingSeasons = await this.programDB.getShowSeasons(dbShow.uuid);

      // TODO: Add seen ids
      for await (const season of this.getTvShowSeasons(show, scanContext)) {
        const dao = this.mintSeasonDao(season, library);
        dao.libraryId = scanContext.library.uuid;
        const upsertResult = await Result.attemptAsync(() =>
          this.programDB.getOrInsertProgramGrouping(dao, {
            externalKey: this.getEntityExternalKey(season),
            externalSourceId: mediaSource.name,
            sourceType: this.mediaSourceType,
          }),
        );

        if (upsertResult.isFailure()) {
          this.logger.warn(upsertResult.error);
          continue;
        }

        const scanEpisodesResult = await this.scanEpisodes(
          show,
          season,
          dbShow,
          upsertResult.get().entity,
          scanContext,
        );

        if (scanEpisodesResult.isFailure()) {
          this.logger.warn(scanEpisodesResult.error);
        }
      }
    });
  }

  protected async scanEpisodes(
    show: ShowT,
    season: SeasonT,
    dbShow: ProgramGroupingWithExternalIds,
    dbSeason: ProgramGroupingWithExternalIds,
    scanContext: ScanContext<ApiClientTypeT>,
  ): Promise<Result<void>> {
    // TODO track incoming
    return Result.attemptAsync(async () => {
      const { library, force } = scanContext;
      const existing =
        await this.programDB.getProgramCanonicalIdsForMediaSource(
          library.uuid,
          ProgramType.Episode,
        );
      for await (const episode of this.getSeasonEpisodes(season, scanContext)) {
        const externalKey = this.getEntityExternalKey(episode);
        if (
          !force &&
          existing[externalKey]?.canonicalId === this.getCanonicalId(episode)
        ) {
          this.logger.debug(
            "Skipping episode key = %s because it hasn't changed",
            externalKey,
          );
          continue;
        }

        // const upsertResult = Result.attemptAsync(() => )
        const fullMetadataResult = await this.getFullEpisodeMetadata(
          episode,
          scanContext,
        );

        const upsertResult = await fullMetadataResult.flatMapAsync(
          (fullEpisode) => {
            const dao = this.mintEpisodeDao(fullEpisode, scanContext);
            dao.tvShowUuid = dbShow.uuid;
            dao.seasonUuid = dbSeason.uuid;
            return Result.attemptAsync(() =>
              this.programDB.upsertPrograms([dao]),
            );
          },
        );

        if (upsertResult.isFailure()) {
          this.logger.warn(upsertResult.error);
        }
      }
    });
  }

  protected abstract getTvShowLibraryContents(
    libraryId: string, // TODO: Full library type?
    context: ScanContext<ApiClientTypeT>,
  ): AsyncIterable<ShowT>;

  protected abstract getTvShowSeasons(
    show: ShowT,
    context: ScanContext<ApiClientTypeT>,
  ): AsyncIterable<SeasonT>;

  protected abstract getSeasonEpisodes(
    season: SeasonT,
    context: ScanContext<ApiClientTypeT>,
  ): AsyncIterable<EpisodeT>;

  protected abstract getCanonicalId(entity: ShowT | SeasonT | EpisodeT): string;

  protected abstract mintShowDao(
    show: ShowT,
    library: MediaSourceLibrary,
  ): NewProgramGroupingWithExternalIds;

  protected abstract mintSeasonDao(
    season: SeasonT,
    library: MediaSourceLibrary,
  ): NewProgramGroupingWithExternalIds;

  protected abstract mintEpisodeDao(
    episode: EpisodeT,
    scanContext: ScanContext<ApiClientTypeT>,
  ): NewProgramWithExternalIds;

  protected abstract getEntityExternalKey(
    show: ShowT | SeasonT | EpisodeT,
  ): string;

  protected abstract getFullEpisodeMetadata(
    episodeT: EpisodeT,
    context: ScanContext<ApiClientTypeT>,
  ): Promise<Result<EpisodeT>>;
}
