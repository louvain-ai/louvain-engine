/** Reader slots in pools, so a read anyone can ask for never queues the others behind it. */
import { ReaderBusy } from "./worker-errors.js";

/**
 * The heap a reader's process may use: four times the largest real input's need under the byte caps. A file
 * that needs more is too large (`WorkerOutOfMemory`), never damaged; buffers outside the heap (a decoded attachment)
 * are bounded by each reader's byte cap.
 */
export const WORKER_HEAP_MB = 256;

/**
 * Readers at once in one process. `MAX_READERS × WORKER_HEAP_MB` (512 MB) bounds their heaps; buffers outside the heap
 * (a decoded attachment, ~4× its input) can take a reader's RSS past it, which is why a reader also asks the kernel to
 * kill it first (`oom_score_adj`, in `serveReader`) rather than the service beside it.
 */
export const MAX_READERS = 2;

/**
 * Reader slots, in pools. Ordinary reads share one pool of `MAX_READERS`; a caller whose reads anyone with a link can
 * ask for brings a pool of its own, so however many it is asked for, the ordinary reads never queue behind it.
 */
export class ReaderPool {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  /** `queue`: at most this many wait for a slot; one more is `ReaderBusy` at once, never a growing queue. */
  constructor(
    readonly size: number,
    readonly queue = Number.POSITIVE_INFINITY,
  ) {}

  /** A reader slot, or `WorkerDeadline` if none frees before `deadline`. */
  async acquire(deadline: number): Promise<void> {
    if (this.running < this.size) {
      this.running++;
      return;
    }
    if (this.waiting.length >= this.queue) throw new ReaderBusy();
    await new Promise<void>((resolve, reject) => {
      const take = () => {
        clearTimeout(timer);
        this.running++;
        resolve();
      };
      const timer = setTimeout(
        () => {
          const at = this.waiting.indexOf(take);
          if (at >= 0) this.waiting.splice(at, 1);
          reject(new ReaderBusy());
        },
        Math.max(0, deadline - Date.now()),
      );
      this.waiting.push(take);
    });
  }

  release(): void {
    this.running--;
    this.waiting.shift()?.();
  }
}

/** The ordinary reads' pool. */
export const SHARED_POOL = new ReaderPool(MAX_READERS);
