import type { Duration } from 'dayjs/plugin/duration.js';
import type { ProgramType } from '../db/schema/Program.ts';

export interface NamedEntity {
  name: string;
}

export type Actor = NamedEntity;
export type Writer = NamedEntity;
export type Director = NamedEntity;
export type Genre = NamedEntity;

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
  language: string;
  channels: number;
  title: string; // ???
  default: boolean;
  hasAttachedPicture: boolean;
  pixelFormat: string;
  // colorRange:
  bitDepth: number;
  fileName?: string;
  mimeType: string;
}

export type MediaItem = {
  streams: MediaStream[];
  duration: Duration;
  sampleAspectRatio: string;
  displayAspectRatio: string;
  frameRate: string; // either number or fractional
  // scan kind
  width: number;
  height: number;
};

export interface Program {
  // metadata
  type: ProgramType;
  title: string;
  originalTitle?: string;

  // media
  mediaStreams: MediaStream[];

  // joins
  actors: Actor[];
  writers: Writer[];
  directors: Director[];
  genres: Genre[];
}

export interface Movie extends Program {
  type: typeof ProgramType.Movie;
}
