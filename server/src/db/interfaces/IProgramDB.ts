import type { ProgramExternalIdType } from '@/db/custom_types/ProgramExternalIdType.js';
import type { ProgramSourceType } from '@/db/custom_types/ProgramSourceType.js';
import type { ProgramDao, ProgramType } from '@/db/schema/Program.js';
import type {
  MinimalProgramExternalId,
  NewProgramExternalId,
  ProgramExternalId,
} from '@/db/schema/ProgramExternalId.js';
import type { ProgramExternalIdSourceType } from '@/db/schema/base.js';
import type {
  NewProgramGroupingWithExternalIds,
  NewProgramWithExternalIds,
  ProgramGroupingWithExternalIds,
  ProgramWithExternalIds,
  ProgramWithRelations,
} from '@/db/schema/derivedTypes.js';
import type { Maybe } from '@/types/util.js';
import type { ChannelProgram, ContentProgram } from '@tunarr/types';
import type { Dictionary, MarkOptional } from 'ts-essentials';
import type { MediaSourceType } from '../schema/MediaSource.ts';
import type { ProgramGroupingType } from '../schema/ProgramGrouping.ts';

export interface IProgramDB {
  getProgramById(id: string): Promise<Maybe<ProgramWithExternalIds>>;

  getProgramExternalIds(
    id: string,
    externalIdTypes?: ProgramExternalIdType[],
  ): Promise<ProgramExternalId[]>;

  getShowIdFromTitle(title: string): Promise<Maybe<string>>;

  updateProgramDuration(programId: string, duration: number): Promise<void>;

  getProgramsByIds(
    ids: string[],
    batchSize: number,
  ): Promise<ProgramWithRelations[]>;

  getProgramGrouping(
    id: string,
  ): Promise<Maybe<ProgramGroupingWithExternalIds>>;

  getProgramGroupingByExternalId(
    eid: ProgramGroupingExternalIdLookup,
  ): Promise<Maybe<ProgramGroupingWithExternalIds>>;

  getProgramParent(
    programId: string,
  ): Promise<Maybe<ProgramGroupingWithExternalIds>>;

  lookupByExternalId(eid: {
    sourceType: ProgramSourceType;
    externalSourceId: string;
    externalKey: string;
  }): Promise<Maybe<ContentProgram>>;

  lookupByExternalIds(
    ids: Set<[string, string, string]>,
  ): Promise<Record<string, ContentProgram>>;

  programIdsByExternalIds(
    ids: Set<[string, string, string]>,
    chunkSize: number,
  ): Promise<
    Record<`${ProgramExternalIdSourceType}.${string}.${string}`, string>
  >;

  updateProgramPlexRatingKey(
    programId: string,
    plexServerName: string,
    details: MarkOptional<
      Pick<
        ProgramExternalId,
        'externalKey' | 'directFilePath' | 'externalFilePath'
      >,
      'directFilePath' | 'externalFilePath'
    >,
  ): Promise<ProgramExternalId>;

  replaceProgramExternalId(
    programId: string,
    newExternalId: NewProgramExternalId,
    oldExternalId?: MinimalProgramExternalId,
  ): Promise<void>;

  upsertContentPrograms(
    programs: ChannelProgram[],
    programUpsertBatchSize?: number,
  ): Promise<ProgramDao[]>;

  upsertPrograms(
    programs: NewProgramWithExternalIds[],
    programUpsertBatchSize?: number,
  ): Promise<ProgramWithExternalIds[]>;

  programIdsByExternalIds(
    ids: Set<[string, string, string]>,
    chunkSize?: number,
  ): Promise<Record<`${string}|${string}|${string}`, string>>;

  getProgramsForMediaSource(
    mediaSourceId: string,
    type?: ProgramType,
  ): Promise<ProgramDao[]>;

  getMediaSourceLibraryPrograms(
    libraryId: string,
  ): Promise<ProgramWithRelations[]>;

  getProgramCanonicalIdsForMediaSource(
    mediaSourceLibraryId: string,
    type: ProgramType,
    parentId?: string,
  ): Promise<Dictionary<ProgramCanonicalIdLookupResult>>;

  getProgramGroupingCanonicalIds(
    mediaSourceLibraryId: string,
    type: ProgramGroupingType,
    sourceType: MediaSourceType,
  ): Promise<Dictionary<ProgramGroupingCanonicalIdLookupResult>>;

  getOrInsertProgramGrouping(
    dao: NewProgramGroupingWithExternalIds,
    externalId: ProgramGroupingExternalIdLookup,
  ): Promise<GetOrInsertResult<ProgramGroupingWithExternalIds>>;

  getShowSeasons(showUuid: string): Promise<ProgramGroupingWithExternalIds[]>;
}

export type ProgramCanonicalIdLookupResult = {
  uuid: string;
  canonicalId: string;
  libraryId: string;
  externalKey: string;
};

export type ProgramGroupingCanonicalIdLookupResult = {
  uuid: string;
  canonicalId: string;
  libraryId: string;
};

export type ProgramGroupingExternalIdLookup = {
  sourceType: ProgramExternalIdSourceType;
  externalKey: string;
  externalSourceId: string;
};

export type GetOrInsertResult<Entity> = {
  wasInserted: boolean;
  wasUpdated: boolean;
  entity: Entity;
};
