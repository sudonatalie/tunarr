import type { ProgramType } from '../db/schema/Program.ts';
import type { ProgramGroupingType } from '../db/schema/ProgramGrouping.ts';
import type { ApiClientOptions } from './BaseApiClient.ts';
import { BaseApiClient } from './BaseApiClient.ts';

export type ProgramTypeMap<MovieType = unknown, ShowType = unknown> = {
  [ProgramType.Movie]: MovieType;
  [ProgramGroupingType.Show]: ShowType;
};

export abstract class MediaSourceApiClient<
  ProgramTypes extends ProgramTypeMap,
  OptionsType extends ApiClientOptions = ApiClientOptions,
> extends BaseApiClient<OptionsType> {
  abstract getMovieLibraryContents(
    libraryId: string,
    pageSize?: number,
  ): AsyncIterable<ProgramTypes['movie']>;

  abstract getTvShowLibraryContents(
    libraryId: string,
    pageSize?: number,
  ): AsyncIterable<ProgramTypes['show']>;
}
