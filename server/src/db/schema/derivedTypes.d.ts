import type { TranscodeConfig } from '@/db/schema/TranscodeConfig.js';
import type { MarkNonNullable } from '@/types/util.js';
import type { DeepNullable, MarkRequired, StrictOmit } from 'ts-essentials';
import type { Channel, ChannelFillerShow } from './Channel.ts';
import type { FillerShow } from './FillerShow.ts';
import type { MediaSource, MediaSourceLibrary } from './MediaSource.ts';
import type { NewProgramDao, ProgramDao } from './Program.ts';
import type {
  MinimalProgramExternalId,
  NewSingleOrMultiExternalId,
} from './ProgramExternalId.ts';
import type { NewProgramGrouping, ProgramGrouping } from './ProgramGrouping.ts';
import type {
  NewProgramGroupingExternalId,
  ProgramGroupingExternalId,
} from './ProgramGroupingExternalId.ts';

export type ProgramWithRelations = ProgramDao & {
  tvShow?: DeepNullable<Partial<ProgramGroupingWithExternalIds>> | null;
  tvSeason?: DeepNullable<Partial<ProgramGroupingWithExternalIds>> | null;
  trackArtist?: DeepNullable<Partial<ProgramGroupingWithExternalIds>> | null;
  trackAlbum?: DeepNullable<Partial<ProgramGroupingWithExternalIds>> | null;
  // Require minimum data from externalId
  externalIds?: MinimalProgramExternalId[];
};

export type ChannelWithRelations = Channel & {
  programs?: ProgramWithRelations[];
  fillerContent?: ProgramWithRelations[];
  fillerShows?: ChannelFillerShow[];
  transcodeConfig?: TranscodeConfig;
};

export type ChannelWithTranscodeConfig = MarkRequired<
  ChannelWithRelations,
  'transcodeConfig'
>;

export type ChannelWithRequiredJoins<Joins extends keyof Channel> =
  MarkRequired<ChannelWithRelations, Joins>;

export type ChannelWithPrograms = MarkRequired<
  ChannelWithRelations,
  'programs'
>;

export type ChannelFillerShowWithRelations = ChannelFillerShow & {
  fillerShow: MarkNonNullable<DeepNullable<FillerShow>, 'uuid'>;
  fillerContent?: ProgramWithRelations[];
};

export type ChannelFillerShowWithContent = MarkRequired<
  ChannelFillerShowWithRelations,
  'fillerContent'
>;

export type ProgramWithExternalIds = ProgramDao & {
  externalIds: MinimalProgramExternalId[];
};

export type NewProgramWithExternalIds = NewProgramDao & {
  externalIds: NewSingleOrMultiExternalId[];
};

export type ProgramGroupingWithExternalIds = ProgramGrouping & {
  externalIds: ProgramGroupingExternalId[];
};

export type NewProgramGroupingWithExternalIds = NewProgramGrouping & {
  externalIds: NewProgramGroupingExternalId[];
};

export type TvShow = {
  [K in keyof StrictOmit<ProgramGrouping, 'type'>]: ProgramGrouping[K];
} & {
  type: 'show';
};

export type MediaSourceWithLibraries = MediaSource & {
  libraries: MediaSourceLibrary[];
};
