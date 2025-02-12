import { ChannelDB } from '@/db/ChannelDB.js';
import { ProgramDB } from '@/db/ProgramDB.js';
import type { IChannelDB } from '@/db/interfaces/IChannelDB.js';
import type { IProgramDB } from '@/db/interfaces/IProgramDB.js';
import { KEYS } from '@/types/inject.js';
import type { interfaces } from 'inversify';
import { ContainerModule } from 'inversify';
import { ProgramDaoMinter } from './converters/ProgramMinter.ts';

const DBModule = new ContainerModule((bind) => {
  bind<IProgramDB>(KEYS.ProgramDB).to(ProgramDB).inSingletonScope();
  bind<IChannelDB>(KEYS.ChannelDB).to(ChannelDB).inSingletonScope();

  bind(ProgramDaoMinter).toSelf();
  bind<interfaces.AutoFactory<ProgramDaoMinter>>(
    KEYS.ProgramDaoMinterFactory,
  ).toAutoFactory<ProgramDaoMinter>(ProgramDaoMinter);
});

export { DBModule as dbContainer };
