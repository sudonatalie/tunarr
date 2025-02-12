import type { JellyfinItemKind } from '@tunarr/types/jellyfin';
import { type JellyfinItem } from '@tunarr/types/jellyfin';
import type { StrictOmit } from 'ts-essentials';

export type SpecificJellyfinType<Typ extends JellyfinItemKind> = StrictOmit<
  JellyfinItem,
  'Type'
> & { Type: Typ };

export type JellyfinMovie = SpecificJellyfinType<'Movie'>;

export type JellyfinSeries = SpecificJellyfinType<'Series'>;

export type JellyfinSeason = SpecificJellyfinType<'Season'>;

export type JellyfinEpisode = SpecificJellyfinType<'Episode'>;

export function isJellyfinType<Typ extends JellyfinItemKind>(
  item: JellyfinItem,
  k: Typ,
): item is SpecificJellyfinType<Typ> {
  return item.Type === k;
}
