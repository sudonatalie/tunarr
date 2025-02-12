import dayjs from 'dayjs';
import type { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type {
  MediaLibraryType,
  MediaSource,
  MediaSourceLibrary,
  MediaSourceType,
} from '../../db/schema/MediaSource.ts';
import { devAssert } from '../../util/debug.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import type { EntityMutex } from '../EntityMutex.ts';

export type ScanRequest = {
  library: MediaSourceLibrary;
  force?: boolean;
};

export type ScanContext<ApiClientTypeT> = {
  library: MediaSourceLibrary;
  mediaSource: MediaSource;
  apiClient: ApiClientTypeT;
  force: boolean;
};

export abstract class MediaSourceScanner<
  MediaLibraryTypeT extends MediaLibraryType,
  MediaSourceTypeT extends MediaSourceType,
  ApiClientTypeT,
> {
  abstract readonly type: MediaLibraryTypeT;
  abstract readonly mediaSourceType: MediaSourceTypeT;

  constructor(
    protected logger: Logger,
    protected mediaSourceDB: MediaSourceDB,
    private entityMutex: EntityMutex,
  ) {}

  async scan({ library, force }: ScanRequest) {
    const lock = await this.entityMutex.lockLibrary(library);
    if (lock.isLocked()) {
      this.logger.warn('Not scanning because resource is locked.');
      return;
    }
    const releaser = await lock.acquire();

    try {
      const mediaSource = await this.mediaSourceDB.getById(
        library.mediaSourceId,
      );

      if (!mediaSource) {
        throw new Error(`Media source ${library.mediaSourceId} not found.`);
      }

      devAssert(mediaSource.type === this.mediaSourceType);

      await this.scanInternal({
        library,
        mediaSource,
        force: force ?? false,
        apiClient: await this.getApiClient(mediaSource),
      });

      await this.mediaSourceDB.setLibraryLastScannedTime(library.uuid, dayjs());
    } finally {
      releaser();
    }
  }

  protected abstract scanInternal(
    context: ScanContext<ApiClientTypeT>,
  ): Promise<void>;

  protected abstract getApiClient(
    mediaSource: MediaSource,
  ): Promise<ApiClientTypeT>;
}
