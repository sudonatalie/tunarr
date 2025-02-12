import { MediaSourceDB } from '@/db/mediaSourceDB.js';
import { MediaSourceApiFactory } from '@/external/MediaSourceApiFactory.js';
import { ScanContext } from '@/services/scanner/MediaSourceScanner.js';
import { JellyfinItem } from '@tunarr/types/jellyfin';
import { inject, injectable, interfaces } from 'inversify';
import { ProgramGroupingMinter } from '../../db/converters/ProgramGroupingMinter.ts';
import { ProgramDaoMinter } from '../../db/converters/ProgramMinter.ts';
import { type IProgramDB } from '../../db/interfaces/IProgramDB.ts';
import { NewProgramWithExternalIds } from '../../db/schema/derivedTypes.js';
import { MediaSource } from '../../db/schema/MediaSource.ts';
import { JellyfinApiClient } from '../../external/jellyfin/JellyfinApiClient.ts';
import { KEYS } from '../../types/inject.ts';
import { Result } from '../../types/result.ts';
import { Logger } from '../../util/logging/LoggerFactory.ts';
import { Canonicalizer } from '../Canonicalizer.ts';
import { EntityMutex } from '../EntityMutex.ts';
import { MediaSourceMovieLibraryScanner } from './MediaSourceMovieLibraryScanner.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';

@injectable()
export class JellyfinMediaSourceMovieScanner extends MediaSourceMovieLibraryScanner<
  'jellyfin',
  JellyfinApiClient,
  JellyfinItem
> {
  readonly mediaSourceType = 'jellyfin';
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
    mediaSourceProgressService: MediaSourceProgressService,
    @inject(ProgramGroupingMinter)
    private programGroupingMinter: ProgramGroupingMinter,
  ) {
    super(
      logger,
      mediaSourceDB,
      entityMutex,
      programDB,
      mediaSourceProgressService,
    );
    this.programMinter = programMinterFactory();
  }

  protected getApiClient(mediaSource: MediaSource): Promise<JellyfinApiClient> {
    return this.mediaSourceApiFactory.getJellyfinApiClient(mediaSource);
  }

  protected getLibraryContents(
    libraryKey: string,
    context: ScanContext<JellyfinApiClient>,
  ): AsyncIterable<JellyfinItem> {
    return context.apiClient.getMovieLibraryContents(libraryKey);
  }

  protected async scanMovie(
    { apiClient, mediaSource, library }: ScanContext<JellyfinApiClient>,
    apiMovie: JellyfinItem,
  ): Promise<Result<NewProgramWithExternalIds>> {
    const fullMetadataResult = await apiClient.getItem(apiMovie.Id);

    if (fullMetadataResult.isFailure()) {
      throw fullMetadataResult.error;
    }

    return fullMetadataResult.map((fullMovie) => {
      if (!fullMovie) {
        throw new Error(`Movie (ID = ${apiMovie.Id}) not found`);
      }

      return this.programMinter.mint(mediaSource, library, {
        sourceType: this.mediaSourceType,
        program: fullMovie,
      });
    });
  }

  protected getLibrarySize(
    libraryKey: string,
    context: ScanContext<JellyfinApiClient>,
  ): Promise<number> {
    return context.apiClient
      .getChildItemCount(libraryKey)
      .then((_) => _.getOrThrow());
  }

  protected getCanonicalId(entity: JellyfinItem): string {
    return this.canonicalizer.getCanonicalId(entity);
  }

  protected getExternalKey(entity: JellyfinItem): string {
    return entity.Id;
  }
}
