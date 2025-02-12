import type { JellyfinItem } from '@tunarr/types/jellyfin';
import type { PlexMedia } from '@tunarr/types/plex';
import { ContainerModule } from 'inversify';
import { KEYS } from '../types/inject.ts';
import type { Canonicalizer } from './Canonicalizer.ts';
import { JellyfinItemCanonicalizer } from './JellyfinItemCanonicalizer.ts';
import { PlexMediaCanonicalizer } from './PlexMediaCanonicalizers.ts';

export const ServicesModule = new ContainerModule((bind) => {
  bind<Canonicalizer<PlexMedia>>(KEYS.PlexCanonicalizer)
    .to(PlexMediaCanonicalizer)
    .inSingletonScope();
  bind<Canonicalizer<JellyfinItem>>(KEYS.JellyfinCanonicalizer)
    .to(JellyfinItemCanonicalizer)
    .inSingletonScope();
});
