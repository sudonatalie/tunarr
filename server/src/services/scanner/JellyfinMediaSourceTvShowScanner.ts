import { MediaSourceDB } from '@/db/mediaSourceDB.js';
import { MediaSourceApiFactory } from '@/external/MediaSourceApiFactory.js';
import { ScanContext } from '@/services/scanner/MediaSourceScanner.js';
import { JellyfinItem } from '@tunarr/types/jellyfin';
import { inject, injectable, interfaces } from 'inversify';
import { isUndefined } from 'lodash-es';
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
  MediaSourceType,
} from '../../db/schema/MediaSource.ts';
import { JellyfinApiClient } from '../../external/jellyfin/JellyfinApiClient.ts';
import { WrappedError } from '../../types/errors.ts';
import { KEYS } from '../../types/inject.ts';
import {
  JellyfinEpisode,
  JellyfinSeason,
  JellyfinSeries,
} from '../../types/JellyfinTypes.ts';
import { Result } from '../../types/result.ts';
import { Logger } from '../../util/logging/LoggerFactory.ts';
import { Canonicalizer } from '../Canonicalizer.ts';
import { EntityMutex } from '../EntityMutex.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import { MediaSourceTvShowLibraryScanner } from './MediaSourceTvShowLibraryScanner.ts';

@injectable()
export class JellyfinMediaSourceTvShowScanner extends MediaSourceTvShowLibraryScanner<
  typeof MediaSourceType.Jellyfin,
  JellyfinApiClient,
  JellyfinSeries,
  JellyfinSeason,
  JellyfinEpisode
> {
  readonly mediaSourceType = MediaSourceType.Jellyfin;

  private programMinter: ProgramDaoMinter;

  constructor(
    @inject(KEYS.Logger) logger: Logger,
    @inject(MediaSourceDB) mediaSourceDB: MediaSourceDB,
    @inject(KEYS.ProgramDB) programDB: IProgramDB,
    @inject(KEYS.JellyfinCanonicalizer)
    private canonicalizer: Canonicalizer<JellyfinItem>,
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
    context: ScanContext<JellyfinApiClient>,
  ): AsyncIterable<JellyfinSeries> {
    return context.apiClient.getTvShowLibraryContents(libraryId);
  }

  protected getTvShowSeasons(
    show: JellyfinItem,
    context: ScanContext<JellyfinApiClient>,
  ): AsyncIterable<JellyfinSeason> {
    return context.apiClient.getTvShowSeasons(show.Id);
  }

  protected getSeasonEpisodes(
    season: JellyfinItem,
    context: ScanContext<JellyfinApiClient>,
  ): AsyncIterable<JellyfinEpisode> {
    return context.apiClient.getEpisodes(season.Id);
  }

  protected getFullEpisodeMetadata(
    episodeT: JellyfinEpisode,
    context: ScanContext<JellyfinApiClient>,
  ): Promise<Result<JellyfinEpisode, WrappedError>> {
    return context.apiClient
      .getItemOfType(episodeT.Id, 'Episode')
      .then((_) =>
        _.flatMap((ep) =>
          isUndefined(ep)
            ? Result.forError(new Error(`Episode ID ${episodeT.Id} not found`))
            : Result.success(ep),
        ),
      );
  }

  protected getApiClient(mediaSource: MediaSource): Promise<JellyfinApiClient> {
    return this.mediaSourceApiFactory.getJellyfinApiClient(mediaSource);
  }

  protected getCanonicalId(entity: JellyfinItem): string {
    return this.canonicalizer.getCanonicalId(entity);
  }

  protected getEntityExternalKey(show: JellyfinItem): string {
    return show.Id;
  }

  protected mintShowDao(
    show: JellyfinSeries,
    library: MediaSourceLibrary,
  ): NewProgramGroupingWithExternalIds {
    return this.programGroupingMinter.mintForJellyfinShow(library, show);
  }

  protected mintSeasonDao(
    season: JellyfinSeason,
    library: MediaSourceLibrary,
  ): NewProgramGroupingWithExternalIds {
    return this.programGroupingMinter.mintForJellyfinSeason(library, season);
  }

  protected mintEpisodeDao(
    episode: JellyfinEpisode,
    scanContext: ScanContext<JellyfinApiClient>,
  ): NewProgramWithExternalIds {
    return this.programMinter.mint(
      scanContext.mediaSource,
      scanContext.library,
      {
        program: episode,
        sourceType: this.mediaSourceType,
      },
    );
  }
}
