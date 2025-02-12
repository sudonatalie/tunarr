import { MediaSourceDB } from '@/db/mediaSourceDB.js';
import { MediaSourceApiFactory } from '@/external/MediaSourceApiFactory.js';
import { ScanContext } from '@/services/scanner/MediaSourceScanner.js';
import {
  PlexEpisode,
  PlexMedia,
  PlexTvSeason,
  PlexTvShow,
} from '@tunarr/types/plex';
import { inject, injectable, interfaces } from 'inversify';
import { ProgramGroupingMinter } from '../../db/converters/ProgramGroupingMinter.ts';
import { ProgramDaoMinter } from '../../db/converters/ProgramMinter.ts';
import { type IProgramDB } from '../../db/interfaces/IProgramDB.ts';
import {
  NewProgramGroupingWithExternalIds,
  NewProgramWithExternalIds,
} from '../../db/schema/derivedTypes.js';
import {
  MediaSource,
  MediaSourceLibrary,
} from '../../db/schema/MediaSource.ts';
import { PlexApiClient } from '../../external/plex/PlexApiClient.ts';
import { WrappedError } from '../../types/errors.ts';
import { KEYS } from '../../types/inject.ts';
import { Result } from '../../types/result.ts';
import { Logger } from '../../util/logging/LoggerFactory.ts';
import { Canonicalizer } from '../Canonicalizer.ts';
import { EntityMutex } from '../EntityMutex.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import { MediaSourceTvShowLibraryScanner } from './MediaSourceTvShowLibraryScanner.ts';

@injectable()
export class PlexMediaSourceTvShowScanner extends MediaSourceTvShowLibraryScanner<
  'plex',
  PlexApiClient,
  PlexTvShow,
  PlexTvSeason,
  PlexEpisode
> {
  readonly mediaSourceType = 'plex';

  private programMinter: ProgramDaoMinter;

  constructor(
    @inject(KEYS.Logger) logger: Logger,
    @inject(MediaSourceDB) mediaSourceDB: MediaSourceDB,
    @inject(KEYS.ProgramDB) programDB: IProgramDB,
    @inject(KEYS.PlexCanonicalizer)
    private canonicalizer: Canonicalizer<PlexMedia>,
    @inject(MediaSourceApiFactory)
    private mediaSourceApiFactory: MediaSourceApiFactory,
    @inject(EntityMutex) entityMutex: EntityMutex,
    @inject(KEYS.ProgramDaoMinterFactory)
    programMinterFactory: interfaces.AutoFactory<ProgramDaoMinter>,
    @inject(MediaSourceProgressService)
    private mediaSourceProgressService: MediaSourceProgressService,
    @inject(ProgramGroupingMinter)
    private programGroupingMinter: ProgramGroupingMinter,
  ) {
    super(logger, mediaSourceDB, entityMutex, programDB);
    this.programMinter = programMinterFactory();
  }

  protected getTvShowLibraryContents(
    libraryId: string,
    context: ScanContext<PlexApiClient>,
  ): AsyncIterable<PlexTvShow> {
    return context.apiClient.getTvShowLibraryContents(libraryId);
  }

  protected getTvShowSeasons(
    show: PlexTvShow,
    context: ScanContext<PlexApiClient>,
  ): AsyncIterable<PlexTvSeason> {
    return context.apiClient.getTvShowSeasons(show.ratingKey);
  }

  protected getSeasonEpisodes(
    season: PlexTvSeason,
    context: ScanContext<PlexApiClient>,
  ): AsyncIterable<PlexEpisode> {
    return context.apiClient.getEpisodes(season.ratingKey);
  }

  protected getFullEpisodeMetadata(
    episodeT: PlexEpisode,
    context: ScanContext<PlexApiClient>,
  ): Promise<Result<PlexEpisode, WrappedError>> {
    return context.apiClient.getEpisodeMetadata(episodeT.ratingKey);
  }

  protected getApiClient(mediaSource: MediaSource): Promise<PlexApiClient> {
    return this.mediaSourceApiFactory.getPlexApiClient(mediaSource);
  }

  protected getCanonicalId(
    entity: PlexTvShow | PlexTvSeason | PlexEpisode,
  ): string {
    return this.canonicalizer.getCanonicalId(entity);
  }

  protected getEntityExternalKey(
    show: PlexTvShow | PlexTvSeason | PlexEpisode,
  ): string {
    return show.ratingKey;
  }

  protected mintShowDao(
    show: PlexTvShow,
    library: MediaSourceLibrary,
  ): NewProgramGroupingWithExternalIds {
    return this.programGroupingMinter.mintForPlexShow(library, show);
  }

  protected mintSeasonDao(
    season: PlexTvSeason,
    library: MediaSourceLibrary,
  ): NewProgramGroupingWithExternalIds {
    return this.programGroupingMinter.mintForPlexSeason(library, season);
  }

  protected mintEpisodeDao(
    episode: PlexEpisode,
    scanContext: ScanContext<PlexApiClient>,
  ): NewProgramWithExternalIds {
    return this.programMinter.mint(
      scanContext.mediaSource,
      scanContext.library,
      {
        program: episode,
        sourceType: 'plex',
      },
    );
  }
}
