import { ProgramExternalIdType } from '@/db/custom_types/ProgramExternalIdType.js';
import type { NewSingleOrMultiProgramGroupingExternalId } from '@/db/schema/ProgramGroupingExternalId.js';
import { isNonEmptyString } from '@/util/index.js';
import { seq } from '@tunarr/shared/util';
import type { ContentProgram } from '@tunarr/types';
import type { JellyfinItem } from '@tunarr/types/jellyfin';
import type {
  PlexEpisode,
  PlexMedia,
  PlexMusicTrack,
  PlexTvSeason,
  PlexTvShow,
} from '@tunarr/types/plex';
import { isValidSingleExternalIdType } from '@tunarr/types/schemas';
import dayjs from 'dayjs';
import { inject, injectable } from 'inversify';
import { first } from 'lodash-es';
import type { MarkRequired } from 'ts-essentials';
import { v4 } from 'uuid';
import { Canonicalizer } from '../../services/Canonicalizer.ts';
import { KEYS } from '../../types/inject.ts';
import { JellyfinSeason, JellyfinSeries } from '../../types/JellyfinTypes.ts';
import type { Nullable } from '../../types/util.ts';
import { parsePlexGuid } from '../../util/externalIds.ts';
import { NewProgramGroupingWithExternalIds } from '../schema/derivedTypes.js';
import { MediaSourceLibrary } from '../schema/MediaSource.ts';
import {
  ProgramGroupingType,
  type NewProgramGrouping,
} from '../schema/ProgramGrouping.ts';

@injectable()
export class ProgramGroupingMinter {
  constructor(
    @inject(KEYS.PlexCanonicalizer)
    private plexCanonicalizer: Canonicalizer<PlexMedia>,
    @inject(KEYS.JellyfinCanonicalizer)
    private jellyfinCanonicalizer: Canonicalizer<JellyfinItem>,
  ) {}

  static mintParentProgramGroupingForPlex(
    plexItem: PlexEpisode | PlexMusicTrack,
  ): NewProgramGrouping {
    const now = +dayjs();

    return {
      uuid: v4(),
      type:
        plexItem.type === 'episode'
          ? ProgramGroupingType.Season
          : ProgramGroupingType.Album,
      createdAt: now,
      updatedAt: now,
      index: plexItem.parentIndex ?? null,
      title: plexItem.parentTitle ?? '',
      summary: null,
      icon: null,
      artistUuid: null,
      showUuid: null,
      year: null,
    };
  }

  static mintParentProgramGroupingForJellyfin(jellyfinItem: JellyfinItem) {
    if (jellyfinItem.Type !== 'Episode' && jellyfinItem.Type !== 'Audio') {
      return null;
    }

    const now = +dayjs();

    return {
      uuid: v4(),
      type:
        jellyfinItem.Type === 'Episode'
          ? ProgramGroupingType.Show
          : ProgramGroupingType.Album,
      createdAt: now,
      updatedAt: now,
      index: jellyfinItem.ParentIndexNumber ?? null,
      title: jellyfinItem.SeasonName ?? jellyfinItem.Album ?? '',
      summary: null,
      icon: null,
      artistUuid: null,
      showUuid: null,
      year: jellyfinItem.ProductionYear,
    } satisfies NewProgramGrouping;
  }

  static mintGroupingExternalIds(
    program: ContentProgram,
    groupingId: string,
    externalSourceId: string,
    mediaSourceId: string,
    relationType: 'parent' | 'grandparent',
  ): NewSingleOrMultiProgramGroupingExternalId[] {
    if (program.subtype === 'movie') {
      return [];
    }

    const now = +dayjs();
    const parentExternalIds: NewSingleOrMultiProgramGroupingExternalId[] = [];

    const ratingKey =
      relationType === 'grandparent'
        ? program.grandparent?.externalKey
        : program.parent?.externalKey;
    if (isNonEmptyString(ratingKey)) {
      parentExternalIds.push({
        type: 'multi',
        uuid: v4(),
        createdAt: now,
        updatedAt: now,
        externalFilePath: null,
        externalKey: ratingKey,
        sourceType: ProgramExternalIdType.PLEX,
        externalSourceId,
        mediaSourceId,
        groupUuid: groupingId,
      });
    }

    const guid = first(
      relationType === 'grandparent'
        ? program.grandparent?.guids
        : program.parent?.guids,
    );
    if (isNonEmptyString(guid)) {
      parentExternalIds.push({
        type: 'single',
        uuid: v4(),
        createdAt: now,
        updatedAt: now,
        externalFilePath: null,
        externalKey: guid,
        sourceType: ProgramExternalIdType.PLEX_GUID,
        groupUuid: groupingId,
      });
    }

    return parentExternalIds;
  }

  static mintGrandparentGrouping(
    item: MarkRequired<ContentProgram, 'grandparent'>,
  ): Nullable<NewProgramGrouping> {
    if (item.subtype === 'movie') {
      return null;
    }

    const now = +dayjs();
    return {
      uuid: v4(),
      type:
        item.subtype === 'episode'
          ? ProgramGroupingType.Show
          : ProgramGroupingType.Artist,
      createdAt: now,
      updatedAt: now,
      index: null,
      title: item.grandparent.title ?? '',
      summary: null,
      icon: null,
      artistUuid: null,
      showUuid: null,
      year: item.grandparent.year,
    };
  }

  static mintParentGrouping(
    item: MarkRequired<ContentProgram, 'parent'>,
  ): Nullable<NewProgramGrouping> {
    if (item.subtype === 'movie') {
      return null;
    }

    const now = +dayjs();
    return {
      uuid: v4(),
      type:
        item.subtype === 'episode'
          ? ProgramGroupingType.Show
          : ProgramGroupingType.Artist,
      createdAt: now,
      updatedAt: now,
      index: item.parent.index,
      title: item.parent.title ?? '',
      summary: null,
      icon: null,
      artistUuid: null,
      showUuid: null,
      year: item.parent.year,
    } satisfies NewProgramGrouping;
  }

  mintForPlexShow(
    mediaSourceLibrary: MediaSourceLibrary,
    show: PlexTvShow,
  ): NewProgramGroupingWithExternalIds {
    const now = +dayjs();

    const id = v4();

    const externalIds: NewProgramGroupingExternalId[] = [
      {
        uuid: v4(),
        createdAt: now,
        updatedAt: now,
        externalKey: show.ratingKey,
        sourceType: ProgramExternalIdType.PLEX,
        groupUuid: id,
      },
      {
        uuid: v4(),
        createdAt: now,
        updatedAt: now,
        externalKey: show.guid,
        sourceType: ProgramExternalIdType.PLEX_GUID,
        groupUuid: id,
      },
      ...seq
        .collect(show.Guid, ({ id }) => parsePlexGuid(id))
        .map(
          (eid) =>
            ({
              uuid: v4(),
              createdAt: now,
              updatedAt: now,
              externalKey: eid.externalKey,
              sourceType: eid.sourceType,
              groupUuid: id,
            }) satisfies NewProgramGroupingExternalId,
        ),
    ];

    return {
      uuid: id,
      type: ProgramGroupingType.Show,
      createdAt: now,
      updatedAt: now,
      index: show.index,
      title: show.title,
      summary: show.summary,
      year: show.year,
      libraryId: mediaSourceLibrary.uuid,
      canonicalId: this.plexCanonicalizer.getCanonicalId(show),
      externalIds,
    } satisfies NewProgramGroupingWithExternalIds;
  }

  mintForJellyfinShow(
    mediaSourceLibrary: MediaSourceLibrary,
    show: JellyfinSeries,
  ): NewProgramGroupingWithExternalIds {
    const now = +dayjs();

    const id = v4();

    const externalIds: NewProgramGroupingExternalId[] = [
      {
        uuid: v4(),
        createdAt: now,
        updatedAt: now,
        externalKey: show.Id,
        sourceType: ProgramExternalIdType.JELLYFIN,
        groupUuid: id,
      },
      ...seq.collectMapValues(show.ProviderIds, (id, provider) => {
        if (!isNonEmptyString(id)) {
          return;
        }
        if (!isValidSingleExternalIdType(provider)) {
          return;
        }

        return {
          uuid: v4(),
          createdAt: now,
          updatedAt: now,
          externalKey: id,
          sourceType: provider,
          groupUuid: id,
        };
      }),
    ];

    return {
      uuid: id,
      type: ProgramGroupingType.Show,
      createdAt: now,
      updatedAt: now,
      index: show.IndexNumber,
      title: show.Name ?? '',
      summary: show.Overview ?? '',
      year: show.ProductionYear,
      libraryId: mediaSourceLibrary.uuid,
      canonicalId: this.jellyfinCanonicalizer.getCanonicalId(show),
      externalIds,
    } satisfies NewProgramGroupingWithExternalIds;
  }

  mintForPlexSeason(
    mediaSourceLibrary: MediaSourceLibrary,
    season: PlexTvSeason,
  ): NewProgramGroupingWithExternalIds {
    const now = +dayjs();

    const id = v4();

    const externalIds: NewProgramGroupingExternalId[] = [
      {
        uuid: v4(),
        createdAt: now,
        updatedAt: now,
        externalKey: season.ratingKey,
        sourceType: ProgramExternalIdType.PLEX,
        groupUuid: id,
      },
      {
        uuid: v4(),
        createdAt: now,
        updatedAt: now,
        externalKey: season.guid,
        sourceType: ProgramExternalIdType.PLEX_GUID,
        groupUuid: id,
      },
      ...seq
        .collect(season.Guid, ({ id }) => parsePlexGuid(id))
        .map(
          (eid) =>
            ({
              uuid: v4(),
              createdAt: now,
              updatedAt: now,
              externalKey: eid.externalKey,
              sourceType: eid.sourceType,
              groupUuid: id,
            }) satisfies NewProgramGroupingExternalId,
        ),
    ];

    return {
      uuid: id,
      type: ProgramGroupingType.Season,
      createdAt: now,
      updatedAt: now,
      index: season.index,
      title: season.title,
      summary: season.summary,
      libraryId: mediaSourceLibrary.uuid,
      canonicalId: this.plexCanonicalizer.getCanonicalId(season),
      externalIds,
    } satisfies NewProgramGroupingWithExternalIds;
  }

  mintForJellyfinSeason(
    mediaSourceLibrary: MediaSourceLibrary,
    season: JellyfinSeason,
  ) {
    const now = +dayjs();

    const id = v4();

    const externalIds: NewProgramGroupingExternalId[] = [
      {
        uuid: v4(),
        createdAt: now,
        updatedAt: now,
        externalKey: season.Id,
        sourceType: ProgramExternalIdType.JELLYFIN,
        groupUuid: id,
      },
      ...seq.collectMapValues(season.ProviderIds, (id, provider) => {
        if (!isNonEmptyString(id)) {
          return;
        }
        if (!isValidSingleExternalIdType(provider)) {
          return;
        }

        return {
          uuid: v4(),
          createdAt: now,
          updatedAt: now,
          externalKey: id,
          sourceType: provider,
          groupUuid: id,
        };
      }),
    ];

    return {
      uuid: id,
      type: ProgramGroupingType.Show,
      createdAt: now,
      updatedAt: now,
      index: season.IndexNumber,
      title: season.Name ?? '',
      summary: season.Overview ?? '',
      year: season.ProductionYear,
      libraryId: mediaSourceLibrary.uuid,
      canonicalId: this.jellyfinCanonicalizer.getCanonicalId(season),
      externalIds,
    } satisfies NewProgramGroupingWithExternalIds;
  }
}
