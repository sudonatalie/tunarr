import { type Maybe } from '@/types/util.js';
import { getChannelId } from '@/util/channels.js';
import { isSuccess } from '@/util/index.js';
import { getTunarrVersion } from '@/util/version.js';
import { PlexClientIdentifier } from '@tunarr/shared/constants';
import type {
  PlexEpisode,
  PlexLibrarySections,
  PlexMediaContainerMetadata,
  PlexMediaContainerResponse,
  PlexMovie,
  PlexTvSeason,
  PlexTvShow,
} from '@tunarr/types/plex';
import {
  MakePlexMediaContainerResponseSchema,
  PlexContainerStatsSchema,
  type PlexDvr,
  type PlexDvrsResponse,
  PlexEpisodeSchema,
  PlexGenericMediaContainerResponseSchema,
  type PlexMedia,
  PlexMediaContainerResponseSchema,
  type PlexMetadataResponse,
  PlexMovieMediaContainerResponseSchema,
  type PlexResource,
  PlexTvSeasonSchema,
  PlexTvShowSchema,
} from '@tunarr/types/plex';
import {
  type AxiosRequestConfig,
  type RawAxiosRequestHeaders,
  isAxiosError,
} from 'axios';
import dayjs from 'dayjs';
import { XMLParser } from 'fast-xml-parser';
import {
  first,
  flatMap,
  forEach,
  isEmpty,
  isError,
  isUndefined,
  map,
  reject,
} from 'lodash-es';
import type { z } from 'zod';
import type { ProgramType } from '../../db/schema/Program.ts';
import type { ProgramGroupingType } from '../../db/schema/ProgramGrouping.ts';
import { Result } from '../../types/result.ts';
import type { ApiClientOptions } from '../BaseApiClient.js';
import { QueryError, type QueryResult } from '../BaseApiClient.js';
import { MediaSourceApiClient } from '../MediaSourceApiClient.ts';
import { PlexQueryCache } from './PlexQueryCache.js';
import { PlexRequestRedacter } from './PlexRequestRedacter.ts';

const PlexCache = new PlexQueryCache();

const PlexHeaders = {
  'X-Plex-Product': 'Tunarr',
  'X-Plex-Client-Identifier': PlexClientIdentifier,
};

type PlexTypes = {
  [ProgramType.Movie]: PlexMovie;
  [ProgramGroupingType.Show]: PlexTvShow;
};

export class PlexApiClient extends MediaSourceApiClient<PlexTypes> {
  protected redacter = new PlexRequestRedacter();
  private opts: ApiClientOptions;
  private accessToken: string;

  constructor(opts: ApiClientOptions) {
    super({
      ...opts,
      extraHeaders: {
        ...PlexHeaders,
        'X-Plex-Version': getTunarrVersion(),
        'X-Plex-Token': opts.accessToken,
      },
      queueOpts: {
        concurrency: 5,
        interval: dayjs.duration({ seconds: 1 }),
      },
    });
    this.opts = opts;
  }

  get serverName() {
    return this.opts.name;
  }

  get serverId() {
    return this.opts.uuid;
  }

  getFullUrl(path: string): string {
    const url = super.getFullUrl(path);
    const parsed = new URL(url);
    parsed.searchParams.set('X-Plex-Token', this.opts.accessToken);
    return parsed.toString();
  }

  // TODO: make all callers use this
  private async doGetResult<T extends PlexMediaContainerMetadata>(
    path: string,
    config: Partial<Omit<AxiosRequestConfig, 'method' | 'url'>> = {},
    skipCache: boolean = false,
  ): Promise<QueryResult<T>> {
    const getter = async (): Promise<QueryResult<T>> => {
      const req: AxiosRequestConfig = {
        method: 'get',
        url: path,
        headers: config.headers,
      };

      if (this.accessToken === '') {
        throw new Error(
          'No Plex token provided. Please use the SignIn method or provide a X-Plex-Token in the Plex constructor.',
        );
      }

      const res = await this.doRequest<PlexMediaContainerResponse<T>>(req);
      if (isSuccess(res)) {
        if (isUndefined(res?.MediaContainer)) {
          this.logger.error(res, 'Expected MediaContainer, got %O', res);
          return this.makeErrorResult('parse_error');
        }

        return this.makeSuccessResult(res?.MediaContainer);
      }

      if (isAxiosError(res) && res.response?.status === 404) {
        return this.makeErrorResult('not_found');
      }

      return this.makeErrorResult('generic_request_error', res.message);
    };

    return this.opts.enableRequestCache && !skipCache
      ? await PlexCache.getOrSetPlexResult<T>(this.opts.name, path, getter)
      : await getter();
  }

  // We're just keeping the old contract here right now...
  async doGetPath<T extends PlexMediaContainerMetadata>(
    path: string,
    optionalHeaders: RawAxiosRequestHeaders = {},
    skipCache: boolean = false,
  ): Promise<Maybe<T>> {
    const result = await this.doGetResult<T>(
      path,
      { headers: optionalHeaders },
      skipCache,
    );

    return result.orUndefined();
  }

  getMovieLibraryContents(
    libraryId: string,
    pageSize: number = 50,
  ): AsyncIterable<PlexMovie> {
    return this.getLibraryContents<PlexMovie>(
      libraryId,
      PlexMovieMediaContainerResponseSchema,
      pageSize,
    );
  }

  getTvShowLibraryContents(
    libraryId: string,
    pageSize: number = 50,
  ): AsyncGenerator<PlexTvShow> {
    return this.getLibraryContents<PlexTvShow>(
      libraryId,
      MakePlexMediaContainerResponseSchema(PlexTvShowSchema),
      pageSize,
    );
  }

  getTvShowSeasons(tvShowKey: string, pageSize: number = 50) {
    return this.getLibraryContents<PlexTvSeason>(
      tvShowKey,
      MakePlexMediaContainerResponseSchema(PlexTvSeasonSchema),
      pageSize,
      `/library/metadata/${tvShowKey}/children`,
    );
  }

  getEpisodes(tvSeasonKey: string, pageSize: number = 50) {
    return this.getLibraryContents<PlexEpisode>(
      tvSeasonKey,
      MakePlexMediaContainerResponseSchema(PlexEpisodeSchema),
      pageSize,
      `/library/metadata/${tvSeasonKey}/children`,
    );
  }

  private async *getLibraryContents<
    ItemType extends PlexMedia,
    SchemaType extends z.ZodType<PlexMetadataResponse<ItemType>> = z.ZodType<
      PlexMetadataResponse<ItemType>
    >,
  >(
    libraryId: string,
    schema: SchemaType,
    pageSize: number = 50,
    key: string = `/library/sections/${libraryId}/all`,
  ): AsyncGenerator<ItemType> {
    const count = await this.getChildCount(key);
    if (count.isFailure()) {
      throw count.error;
    }

    const totalPages = Math.ceil(count.get() / pageSize);
    for (let page = 0; page <= totalPages; page++) {
      const chunkResult = await this.doTypeCheckedGet(key, schema, {
        params: {
          'X-Plex-Container-Size': pageSize,
          'X-Plex-Container-Start': page * pageSize,
        },
      });

      if (chunkResult.isFailure()) {
        throw chunkResult.error;
      }

      for (const item of chunkResult.get().MediaContainer.Metadata ?? []) {
        yield item;
      }
    }

    return;
  }

  async getLibraries() {
    return this.doGetResult<PlexLibrarySections>('/library/sections');
  }

  async getLibraryCount(libraryId: string) {
    return this.getChildCount(`/library/sections/${libraryId}/all`);
  }

  async getItemChildCount(key: string) {
    return this.getChildCount(`/library/metadata/${key}/children`);
  }

  private getChildCount(key: string) {
    return this.doTypeCheckedGet(key, PlexContainerStatsSchema, {
      params: {
        'X-Plex-Container-Size': 0,
        'X-Plex-Container-Start': 0,
      },
    }).then((result) =>
      result.map(
        (stats) => stats.MediaContainer.totalSize ?? stats?.MediaContainer.size,
      ),
    );
  }

  private async getItemMetadataInternal<
    ItemType,
    SchemaType extends z.ZodType<PlexMetadataResponse<ItemType>>,
  >(key: string, schema: SchemaType): Promise<QueryResult<ItemType>> {
    const responseResult = await this.doTypeCheckedGet(
      `/library/metadata/${key}`,
      schema,
      {
        params: {
          includeMarkers: 1,
          includeChapters: 1,
          includeChildren: 1,
          includeLoudnessRamps: 1,
          includeExtras: 1,
        },
      },
    );

    return responseResult
      .flatMap<ItemType>((parsedResponse) => {
        const media = first(parsedResponse.MediaContainer.Metadata);
        if (!isUndefined(media)) {
          return this.makeSuccessResult<ItemType>(media);
        }
        this.logger.error(
          'Could not extract Metadata object for Plex media, key = %s',
          key,
        );
        return this.makeErrorResult('parse_error');
      })
      .mapError((e) =>
        QueryError.isQueryError(e)
          ? e
          : QueryError.genericQueryError(e.message),
      );
  }

  async getItemMetadata(key: string): Promise<QueryResult<PlexMedia>> {
    return this.getItemMetadataInternal(key, PlexMediaContainerResponseSchema);
  }

  async getMovieMetadata(key: string): Promise<QueryResult<PlexMovie>> {
    return this.getItemMetadataInternal(
      key,
      PlexMovieMediaContainerResponseSchema,
    );
  }

  async getSeasonMetadata(key: string): Promise<QueryResult<PlexTvSeason>> {
    return this.getItemMetadataInternal(
      key,
      MakePlexMediaContainerResponseSchema(PlexTvSeasonSchema),
    );
  }

  async getEpisodeMetadata(key: string): Promise<QueryResult<PlexEpisode>> {
    return this.getItemMetadataInternal(
      key,
      MakePlexMediaContainerResponseSchema(PlexEpisodeSchema),
    );
  }

  async checkServerStatus() {
    try {
      const result = await this.doTypeCheckedGet(
        '/',
        PlexGenericMediaContainerResponseSchema,
      );
      if (result.isFailure()) {
        throw result.error;
      } else if (isUndefined(result)) {
        // Parse error - indicates that the URL is probably not a Plex server
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(err, 'Error getting Plex server status');
      return false;
    }
  }

  async getDvrs() {
    try {
      const result = await this.doGetPath<PlexDvrsResponse>('/livetv/dvrs');
      return result?.Dvr ?? [];
    } catch (err) {
      this.logger.error(err, 'GET /livetv/drs failed');
      throw err;
    }
  }

  async getResources() {}

  async refreshGuide(_dvrs?: PlexDvr[]) {
    const dvrs = !isUndefined(_dvrs) ? _dvrs : await this.getDvrs();
    if (!dvrs) {
      throw new Error('Could not retrieve Plex DVRs');
    }

    for (const dvr of dvrs) {
      await this.doPost({ url: `/livetv/dvrs/${dvr.key}/reloadGuide` });
    }
  }

  async refreshChannels(
    channels: { number: number; stealth: number; uuid: string }[],
    providedDvrs?: PlexDvr[],
  ) {
    const liveChannels = reject(channels, { stealth: 1 });
    const dvrs = !isEmpty(providedDvrs) ? providedDvrs : await this.getDvrs();
    if (!dvrs) {
      throw new Error('Could not retrieve Plex DVRs');
    }

    if (isEmpty(dvrs)) {
      return;
    }

    const qs: Record<string, number | string> = {
      channelsEnabled: map(liveChannels, 'number').join(','),
    };

    forEach(channels, ({ number }) => {
      const id = getChannelId(number);
      qs[`channelMapping[${number}]`] = number;
      qs[`channelMappingByKey[${number}]`] = id;
    });

    const keys = map(
      flatMap(dvrs, ({ Device }) => Device),
      (device) => device.key,
    );

    for (const key of keys) {
      await this.doPut({
        url: `/media/grabbers/devices/${key}/channelmap`,
        params: qs,
      });
    }
  }

  async getDevices(): Promise<Maybe<PlexTvDevicesResponse>> {
    const response = await this.doRequest<string>({
      method: 'get',
      baseURL: 'https://plex.tv',
      url: '/devices.xml',
    });

    if (isError(response)) {
      this.logger.error(response);
      return;
    }

    const parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
    }).parse(response) as PlexTvDevicesResponse;
    return parsed;
  }

  getThumbUrl(opts: {
    itemKey: string;
    width?: number;
    height?: number;
    upscale?: string;
  }) {
    return PlexApiClient.getThumbUrl({
      uri: this.opts.uri,
      accessToken: this.opts.accessToken,
      itemKey: opts.itemKey,
      width: opts.width,
      height: opts.height,
      upscale: opts.upscale,
    });
  }

  setEnableRequestCache(enable: boolean) {
    this.opts.enableRequestCache = enable;
  }

  protected override preRequestValidate<T>(
    req: AxiosRequestConfig,
  ): Maybe<QueryResult<T>> {
    if (isEmpty(this.accessToken)) {
      return Result.failure(
        QueryError.create(
          'no_access_token',
          'No Plex token provided. Please use the SignIn method or provide a X-Plex-Token in the Plex constructor.',
        ),
      );
    }
    return super.preRequestValidate(req);
  }

  static getThumbUrl(opts: {
    uri: string;
    accessToken: string;
    itemKey: string;
    width?: number;
    height?: number;
    upscale?: string;
  }): string {
    const { uri, accessToken, itemKey, width, height, upscale } = opts;
    const cleanKey = itemKey.replaceAll(/\/library\/metadata\//g, '');

    let thumbUrl: URL;
    const key = `/library/metadata/${cleanKey}/thumb?X-Plex-Token=${accessToken}`;
    if (isUndefined(height) || isUndefined(width)) {
      thumbUrl = new URL(`${uri}${key}`);
    } else {
      thumbUrl = new URL(`${uri}/photo/:/transcode`);
      thumbUrl.searchParams.append('url', key);
      thumbUrl.searchParams.append('X-Plex-Token', accessToken);
      thumbUrl.searchParams.append('width', width.toString());
      thumbUrl.searchParams.append('height', height.toString());
      thumbUrl.searchParams.append('upscale', (upscale ?? '1').toString());
    }
    return thumbUrl.toString();
  }
}

type PlexTvDevicesResponse = {
  MediaContainer: { Device: PlexResource[] };
};
