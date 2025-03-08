import type { Resolution } from '@tunarr/types';
import type { ExternalIdType } from '@tunarr/types/schemas';
import type dayjs from 'dayjs';
import type { Duration } from 'dayjs/plugin/duration.js';
import type { MarkRequired } from 'ts-essentials';
import type { ProgramType } from '../db/schema/Program.ts';
import type { ProgramGroupingType } from '../db/schema/ProgramGrouping.ts';
import type { Nullable } from './util.ts';

export interface NamedEntity {
  name: string;
}

export type Actor = NamedEntity;
export type Writer = NamedEntity;
export type Director = NamedEntity;
export type Genre = NamedEntity;
export type Studio = NamedEntity;

export type MediaStreamTypes = {
  Video: 'video';
  Audio: 'audio';
  Subtitles: 'subtitles';
  Attachment: 'attachment';
  ExternalSubtitles: 'external_subtitles';
};

export type MediaStreamType = MediaStreamTypes[keyof MediaStreamTypes];

export interface MediaStream {
  // ID?
  index: number;
  codec: string;
  profile: string;
  streamType: MediaStreamType;
  languageCodeISO6392?: string;
  channels?: number; // Audio only
  title?: string; // ???
  default?: boolean;
  hasAttachedPicture?: boolean;
  pixelFormat?: string;
  bitDepth?: number;
  fileName?: string;
  mimeType?: string;
  // Is the stream selected based on the source preferences
  selected?: boolean;
}

export type MediaItem = {
  streams: MediaStream[];
  duration: Duration;
  sampleAspectRatio: string;
  displayAspectRatio: string;
  frameRate?: string; // either number or fractional
  // scan kind
  resolution?: Resolution;
  // width: number;
  // height: number;
};

interface ItemBase {
  uuid?: string;
  type: ProgramType | ProgramGroupingType;
  identifiers: Identifier[];
  title: string;
}

export interface Program extends ItemBase {
  // metadata
  type: ProgramType;
  title: string;
  originalTitle: Nullable<string>;
  year: Nullable<number>;
  releaseDate: Nullable<dayjs.Dayjs>;
  canonicalId: string;

  // media
  mediaItem: MediaItem;

  // joins
  actors: Actor[];
  writers: Writer[];
  directors: Director[];
  genres: Genre[];
  studios: Studio[];
}

interface WithSummaryMetadata {
  summary: Nullable<string>;
  plot: Nullable<string>;
  tagline: Nullable<string>;
}

export interface Identifier {
  id: string;
  sourceId?: string;
  type: ExternalIdType;
}

export interface Movie extends Program, WithSummaryMetadata {
  type: typeof ProgramType.Movie;
  rating: Nullable<string>;
}

export interface Show extends ItemBase {
  type: typeof ProgramGroupingType.Show;
  seasons: Season[];
  rating: Nullable<string>;
  year: Nullable<number>;
}

export interface Season extends ItemBase {
  type: typeof ProgramGroupingType.Season;
  summary: Nullable<string>;
  year: Nullable<number>;

  // joins
  show: Show;
  episodes: Episode[];
}

export interface Episode extends Program {
  type: typeof ProgramType.Episode;
  episodeNumber: number;
  summary: Nullable<string>;
  season: Season;
}

export type Persisted<ProgramT extends ItemBase> = MarkRequired<
  ProgramT,
  'uuid'
> & {
  [Key in keyof Omit<ProgramT, 'uuid'>]: ProgramT[Key] extends ItemBase
    ? Persisted<ProgramT[Key]>
    : ProgramT[Key];
};

// export type Persisted<ProgramT extends ItemBase> =
//   ProgramT extends Movie | Show | Season ? MarkRequired<ProgramT, 'uuid'> :
//     ProgramT extends Episode
