import * as Comlink from 'comlink';

let workerInstance;
let isInitialized = false;

export const getWorkerInstance = () => {
  if (typeof window === 'undefined') {
    return;
  }

  if (!isInitialized) {
    const worker = new Worker(new URL('./workers/image.worker', import.meta.url), { type: 'module' });
    workerInstance = Comlink.wrap(worker);
    isInitialized = true;
  }
  return workerInstance;
};
