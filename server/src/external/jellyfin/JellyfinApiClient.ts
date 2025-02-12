import { JellyfinRequestRedacter } from '@/external/jellyfin/JellyfinRequestRedacter.js';
import type { Maybe, Nilable } from '@/types/util.js';
import { isNonEmptyString } from '@/util/index.js';
import { LoggerFactory } from '@/util/logging/LoggerFactory.js';
import { getTunarrVersion } from '@/util/version.js';
import type {
  JellyfinItem,
  JellyfinItemFields,
  JellyfinItemKind,
  JellyfinItemSortBy,
} from '@tunarr/types/jellyfin';
import {
  JellyfinAuthenticationResult,
  JellyfinLibraryItemsResponse,
  JellyfinLibraryResponse,
  JellyfinSystemInfo,
  JellyfinUser,
} from '@tunarr/types/jellyfin';
import type { AxiosRequestConfig } from 'axios';
import axios, { isAxiosError } from 'axios';
import {
  find,
  isBoolean,
  isEmpty,
  isNil,
  isNumber,
  mapValues,
  omitBy,
  union,
} from 'lodash-es';
import { v4 } from 'uuid';
import { z } from 'zod';
import type { ProgramType } from '../../db/schema/Program.ts';
import type { ProgramGroupingType } from '../../db/schema/ProgramGrouping.ts';
import type {
  JellyfinEpisode,
  JellyfinMovie,
  JellyfinSeason,
  JellyfinSeries,
  SpecificJellyfinType,
} from '../../types/JellyfinTypes.ts';
import { isJellyfinType } from '../../types/JellyfinTypes.ts';
import type { ApiClientOptions, QueryResult } from '../BaseApiClient.js';
import { MediaSourceApiClient } from '../MediaSourceApiClient.ts';

const RequiredLibraryFields = [
  'Path',
  'Genres',
  'Tags',
  'DateCreated',
  'Etag',
  'Overview',
  'Taglines',
  'Studios',
  'People',
  'OfficialRating',
  'ProviderIds',
  'Chapters',
  'MediaStreams',
  'MediaSources',
] satisfies JellyfinItemFields[];

function getJellyfinAuthorization(
  apiKey: Maybe<string>,
  clientId: Maybe<string>,
) {
  const parts: string[] = [];
  if (isNonEmptyString(apiKey)) {
    parts.push(`Token="${apiKey}"`);
  }
  if (isNonEmptyString(clientId)) {
    parts.push(`DeviceId="${clientId}"`);
  }
  parts.push(
    'Client="Tunarr", Device="Web Browser"',
    `Version="${getTunarrVersion()}"`,
  );

  return `MediaBrowser ${parts.join(', ')}`;
}

export type JellyfinApiClientOptions = Omit<ApiClientOptions, 'type'> & {
  userId?: string;
};

export type JellyfinGetItemsQuery = {
  recursive?: boolean;
  searchTerm?: string;
  nameStartsWith?: string;
  nameStartsWithOrGreater?: string;
  nameLessThan?: string;
  genres?: string[];
  ids?: string[];
  hasImdbId?: boolean;
  hasTmdbId?: boolean;
  hasTvdbId?: boolean;
};

type JellyfinItemTypes = {
  [ProgramType.Movie]: JellyfinItem;
  [ProgramGroupingType.Show]: JellyfinItem;
};

export class JellyfinApiClient extends MediaSourceApiClient<
  JellyfinItemTypes,
  JellyfinApiClientOptions
> {
  protected redacter = new JellyfinRequestRedacter();

  constructor(options: JellyfinApiClientOptions) {
    super({
      ...options,
      extraHeaders: {
        ...options.extraHeaders,
        Accept: 'application/json',
        Authorization: getJellyfinAuthorization(options.accessToken, undefined),
      },
    });
  }

  static async findAdminUser(
    server: Omit<ApiClientOptions, 'apiKey' | 'type'>,
    apiKey: string,
  ) {
    try {
      const response = await axios.get(`${server.uri}/Users`, {
        headers: {
          Authorization: getJellyfinAuthorization(apiKey, undefined),
        },
      });

      const users = await z.array(JellyfinUser).parseAsync(response.data);

      return find(
        users,
        (user) =>
          !!user.Policy?.IsAdministrator &&
          !user.Policy?.IsDisabled &&
          !!user.Policy?.EnableAllFolders,
      );
    } catch (e) {
      LoggerFactory.root.error(e, 'Error retrieving Jellyfin users', {
        className: JellyfinApiClient.name,
      });
      return;
    }
  }

  static async login(
    serverUrl: string,
    username: string,
    password: string,
    clientId: string = v4(),
  ) {
    try {
      const response = await axios.post(
        `${serverUrl}/Users/AuthenticateByName`,
        {
          Username: username,
          Pw: password,
        },
        {
          headers: {
            Authorization: getJellyfinAuthorization(undefined, clientId),
          },
        },
      );

      return await JellyfinAuthenticationResult.parseAsync(response.data);
    } catch (e) {
      if (isAxiosError(e) && e.config) {
        new JellyfinRequestRedacter().redact(e.config);
      }

      LoggerFactory.root.error(
        { error: e as unknown, className: JellyfinApiClient.name },
        'Error logging into Jellyfin',
      );
      throw e;
    }
  }

  async ping() {
    try {
      await this.doGet({
        url: '/System/Ping',
      });
      return true;
    } catch (e) {
      this.logger.error(e);
      return false;
    }
  }

  async getSystemInfo() {
    return this.doTypeCheckedGet('/System/Info', JellyfinSystemInfo);
  }

  async getUserLibraries(userId?: string) {
    return this.doTypeCheckedGet(
      '/Library/VirtualFolders',
      JellyfinLibraryResponse,
      { params: { userId } },
    );
  }

  async getUserViews(userId?: string) {
    return this.doTypeCheckedGet('/UserViews', JellyfinLibraryItemsResponse, {
      params: {
        userId: userId ?? this.options.userId,
        includeExternalContent: false,
        presetViews: [
          'movies',
          'tvshows',
          'music',
          'playlists',
          'folders',
          'homevideos',
          'boxsets',
          'trailers',
          'musicvideos',
        ],
      },
    });
  }

  async getItemOfType<ItemTypeT extends JellyfinItemKind>(
    itemId: string,
    itemType: ItemTypeT,
    extraFields: JellyfinItemFields[] = [],
  ): Promise<QueryResult<Maybe<SpecificJellyfinType<ItemTypeT>>>> {
    return this.getItem(itemId, itemType, extraFields).then((result) => {
      return result.mapPure((item) =>
        item && isJellyfinType(item, itemType) ? item : undefined,
      );
    });
  }

  async getItem<ItemTypeT extends JellyfinItemKind>(
    itemId: string,
    itemType: ItemTypeT | null = null,
    extraFields: JellyfinItemFields[] = [],
  ): Promise<QueryResult<Maybe<JellyfinItem>>> {
    const result = await this.getItems(
      null,
      null,
      itemType ? [itemType] : null,
      ['MediaStreams', 'MediaSources', ...extraFields],
      { offset: 0, limit: 1 },
      {
        ids: [itemId],
      },
    );

    return result.mapPure((data) => {
      return find(data.Items, (item) => item.Id === itemId);
    });
  }

  async getItems(
    userId: Nilable<string>, // Not required if we are using an access token
    libraryId: Nilable<string>,
    itemTypes: Nilable<JellyfinItemKind[]> = null,
    extraFields: JellyfinItemFields[] = [],
    pageParams: Nilable<{ offset: number; limit: number }> = null,
    extraParams: JellyfinGetItemsQuery = {},
    sortBy: [JellyfinItemSortBy, ...JellyfinItemSortBy[]] = [
      'SortName',
      'ProductionYear',
    ],
  ): Promise<QueryResult<JellyfinLibraryItemsResponse>> {
    return this.doTypeCheckedGet('/Items', JellyfinLibraryItemsResponse, {
      params: omitBy(
        {
          userId: userId ?? this.options.userId,
          parentId: libraryId,
          fields: union(extraFields, RequiredLibraryFields).join(','),
          startIndex: pageParams?.offset,
          limit: pageParams?.limit,
          // These will be configurable eventually
          sortOrder: 'Ascending',
          sortBy: sortBy.join(','),
          recursive: extraParams.recursive?.toString() ?? 'true',
          includeItemTypes: itemTypes ? itemTypes.join(',') : undefined,
          ...{
            ...mapValues(extraParams, (v) => (isBoolean(v) ? v.toString() : v)),
            ids: extraParams.ids?.join(','),
            genres: extraParams.genres?.join('|'),
          },
        },
        (v) => isNil(v) || (!isNumber(v) && isEmpty(v)),
      ),
    });
  }

  getMovieLibraryContents(
    parentId: string,
    pageSize: number = 50,
  ): AsyncIterable<JellyfinMovie> {
    return this.getChildContents(parentId, 'Movie', [], pageSize);
  }

  getTvShowLibraryContents(
    parentId: string,
    pageSize: number = 50,
  ): AsyncIterable<JellyfinSeries> {
    return this.getChildContents(parentId, 'Series', ['Overview'], pageSize);
  }

  getTvShowSeasons(
    parentId: string,
    pageSize: number = 50,
  ): AsyncIterable<JellyfinSeason> {
    return this.getChildContents(parentId, 'Season', ['Overview'], pageSize);
  }

  getEpisodes(
    parentId: string,
    pageSize: number = 50,
  ): AsyncIterable<JellyfinEpisode> {
    return this.getChildContents(parentId, 'Episode', [], pageSize);
  }

  private async *getChildContents<ItemTypeT extends JellyfinItemKind>(
    parentId: string,
    itemType: ItemTypeT,
    extraFields: JellyfinItemFields[] = [],
    pageSize: number = 50,
  ): AsyncIterable<SpecificJellyfinType<ItemTypeT>> {
    const count = await this.getChildItemCount(parentId);
    if (count.isFailure()) {
      return count;
    }

    const totalPages = Math.ceil(count.get() / pageSize);

    for (let page = 0; page <= totalPages; page++) {
      const chunkResult = await this.getItems(
        null,
        parentId,
        [itemType],
        extraFields,
        {
          offset: page * pageSize,
          limit: pageSize,
        },
      );

      if (chunkResult.isFailure()) {
        throw chunkResult.error;
      }

      for (const item of chunkResult.get().Items ?? []) {
        if (isJellyfinType(item, itemType)) {
          yield item;
        }
      }
    }

    return;
  }

  async getChildItemCount(parentId: string) {
    return this.doTypeCheckedGet('/Items', JellyfinLibraryItemsResponse, {
      params: {
        userId: this.options.userId,
        parentId,
        startIndex: 0,
        limit: 0,
      },
    }).then((_) => _.map((response) => response.TotalRecordCount));
  }

  getThumbUrl(id: string) {
    // Naive impl for now...
    return `${this.options.uri}/Items/${id}/Images/Primary`;
  }

  async recordPlaybackStart(itemId: string, deviceId: string) {
    return this.doPost({
      url: '/Sessions/Playing',
      params: {
        userId: this.options.userId,
      },
      headers: {
        Authorization: getJellyfinAuthorization(
          this.options.accessToken,
          deviceId,
        ),
      },
      data: {
        ItemId: itemId,
        PlayMethod: 'DirectStream',
        PositionTicks: 0,
        CanSeek: false,
      },
    });
  }

  async updateUserItemPlayback(itemId: string, elapsedMs: number) {
    return this.doPost({
      url: `/UserItems/${itemId}/UserData`,
      params: {
        userId: this.options.userId,
      },
      data: {
        PlaybackPositionTicks: elapsedMs * 10000,
      },
    });
  }

  async recordPlaybackProgress(
    itemId: string,
    elapsedMs: number,
    deviceId: string,
    isStopped: boolean = false,
  ) {
    return this.doPost({
      url: `/Sessions/Playing/${isStopped ? 'Stopped' : 'Progress'}`,
      params: {
        userId: this.options.userId,
      },
      headers: {
        Authorization: getJellyfinAuthorization(
          this.options.accessToken,
          deviceId,
        ),
      },
      data: {
        ItemId: itemId,
        PlayMethod: 'DirectStream',
        PositionTicks: elapsedMs * 10000,
        CanSeek: false,
      },
    });
  }

  static getThumbUrl(opts: {
    uri: string;
    accessToken: string;
    itemKey: string;
    width?: number;
    height?: number;
    upscale?: string;
  }): string {
    return `${opts.uri}/Items/${opts.itemKey}/Images/Primary`;
  }

  protected override preRequestValidate<T>(
    req: AxiosRequestConfig,
  ): Maybe<QueryResult<T>> {
    if (isEmpty(this.options.accessToken)) {
      return this.makeErrorResult(
        'no_access_token',
        'No Plex token provided. Please use the SignIn method or provide a X-Plex-Token in the Plex constructor.',
      );
    }
    return super.preRequestValidate(req);
  }
}
