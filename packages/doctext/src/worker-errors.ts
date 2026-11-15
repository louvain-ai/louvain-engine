/** Why a read in a reader process did not answer: each says whether it is a fact about the file or the host's. */

export class WorkerDeadline extends Error {
  constructor() {
    super("Reading the file took too long");
  }
}

/**
 * No reader ran: the deadline passed while waiting for a slot. A `WorkerDeadline` to every caller that already handles
 * one, and told apart by a caller that keeps a failure as a fact about the file (a public render): waiting
 * behind another read says nothing about this one.
 */
export class ReaderBusy extends WorkerDeadline {}

/** The reader needed more memory than its process is given (`WORKER_HEAP_MB`): the file is too large to read. */
export class WorkerOutOfMemory extends Error {
  constructor() {
    super("The file needs more memory to read than a reader is given");
  }
}

/**
 * The reader's process could not be started (the host is out of processes, memory or file handles): later, not a
 * fact about the file, retried, and never counted against it.
 */
export class ReaderUnavailable extends Error {
  /**
   * A shortage that passes (EAGAIN, EMFILE, ENFILE, ENOMEM: the host under load) as against a deployment that cannot
   * read at all (ENOENT, EACCES: a missing or unexecutable binary or entry). Only a passing one is retried for free; a
   * broken image must use up attempts and be reported, or every calendar and mail would wait for ever, silently.
   */
  constructor(
    readonly transient: boolean,
    readonly code: string,
  ) {
    super(
      transient
        ? "A reader could not be started; it will be tried again"
        : `A reader could not be started (${code}): the deployment cannot run one`,
    );
  }
}

/** A reader's own failure, carried back: its message, and whether the input was not the format at all. */
export class WorkerFailed extends Error {
  constructor(
    message: string,
    readonly unparsable: boolean,
  ) {
    super(message);
  }
}
