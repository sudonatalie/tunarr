import { MediaSourceDB } from '@/db/mediaSourceDB.js';
import { MediaSourceApiFactory } from '@/external/MediaSourceApiFactory.js';
import { ScanContext } from '@/services/scanner/MediaSourceScanner.js';
import { PlexMedia, PlexMovie } from '@tunarr/types/plex';
import { inject, injectable, interfaces } from 'inversify';
import { ProgramConverter } from '../../db/converters/ProgramConverter.ts';
import { ProgramDaoMinter } from '../../db/converters/ProgramMinter.ts';
import { type IProgramDB } from '../../db/interfaces/IProgramDB.ts';
import { NewMovieProgram } from '../../db/schema/derivedTypes.js';
import { MediaSource } from '../../db/schema/MediaSource.ts';
import {
  NormalizedPlexMovie,
  PlexApiClient,
} from '../../external/plex/PlexApiClient.ts';
import { KEYS } from '../../types/inject.ts';
import { Movie } from '../../types/Media.ts';
import { Result } from '../../types/result.ts';
import { Logger } from '../../util/logging/LoggerFactory.ts';
import { Canonicalizer } from '../Canonicalizer.ts';
import { EntityMutex } from '../EntityMutex.ts';
import { MeilisearchService } from '../SearchService.ts';
import { MediaSourceMovieLibraryScanner } from './MediaSourceMovieLibraryScanner.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';

@injectable()
export class PlexMediaSourceMovieScanner extends MediaSourceMovieLibraryScanner<
  'plex',
  PlexApiClient,
  NormalizedPlexMovie
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
    mediaSourceProgressService: MediaSourceProgressService,
    @inject(MeilisearchService) searchService: MeilisearchService,
    @inject(ProgramConverter) programConverter: ProgramConverter,
  ) {
    super(
      logger,
      mediaSourceDB,
      entityMutex,
      programDB,
      mediaSourceProgressService,
      searchService,
      programConverter,
    );
    this.programMinter = programMinterFactory();
  }

  protected getApiClient(mediaSource: MediaSource): Promise<PlexApiClient> {
    return this.mediaSourceApiFactory.getPlexApiClient(mediaSource);
  }

  protected getLibrarySize(
    libraryKey: string,
    context: ScanContext<PlexApiClient>,
  ): Promise<number> {
    return context.apiClient
      .getLibraryCount(libraryKey)
      .then((_) => _.getOrThrow());
  }

  protected getLibraryContents(
    libraryKey: string,
    context: ScanContext<PlexApiClient>,
  ): AsyncIterable<Movie> {
    return context.apiClient.getMovieLibraryContents(libraryKey);
  }

  protected async scanMovie(
    { apiClient, mediaSource, library }: ScanContext<PlexApiClient>,
    apiMovie: PlexMovie,
  ): Promise<Result<NewMovieProgram>> {
    const fullMetadataResult = await apiClient.getMovieMetadata(
      apiMovie.ratingKey,
    );

    if (fullMetadataResult.isFailure()) {
      throw fullMetadataResult.error;
    }

    return fullMetadataResult.map((fullMovie) => {
      return this.programMinter.mintMovie(mediaSource, library, {
        sourceType: 'plex',
        program: fullMovie,
      });
    });
  }

  protected getCanonicalId(entity: PlexMovie): string {
    return this.canonicalizer.getCanonicalId(entity);
  }

  protected getExternalKey(entity: NormalizedPlexMovie): string {
    return entity.plexId;
  }
}
