import dayjs from 'dayjs';
import events from 'events';
import { injectable } from 'inversify';
import { TypedEventEmitter } from '../../types/eventEmitter.ts';
import { Maybe } from '../../types/util.ts';

type Events = {
  scanStart: (libraryId: string) => void;
  scanProgress: (libraryId: string, percentComplete: number) => void;
};

abstract class Emitter extends (events.EventEmitter as new () => TypedEventEmitter<Events>) {}

type ScanState = {
  startedAt: dayjs.Dayjs;
  percentComplete: number;
};

@injectable()
export class MediaSourceProgressService extends Emitter {
  #scanDetails: Map<string, ScanState> = new Map();

  constructor() {
    super();
  }

  scanStarted(libraryId: string) {
    this.emit('scanStart', libraryId);
    this.#scanDetails.set(libraryId, {
      startedAt: dayjs(),
      percentComplete: 0,
    });
  }

  scanProgress(libraryId: string, percentComplete: number) {
    this.emit('scanProgress', libraryId, percentComplete);
    const existing = this.#scanDetails.get(libraryId);
    if (existing) {
      this.#scanDetails.set(libraryId, { ...existing, percentComplete });
    }
  }

  getScanProgress(libraryId: string): Maybe<ScanState> {
    return this.#scanDetails.get(libraryId);
  }
}
