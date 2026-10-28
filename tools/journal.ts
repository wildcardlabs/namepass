import { closeSync, constants, fchmodSync, fstatSync, ftruncateSync, openSync, readSync, writeFileSync } from "node:fs";

/** Read a small journal only after validating the opened file, without following symlinks. */
export function readJournal(path: string, maxBytes = 65_536): unknown {
  if (!process.geteuid || !constants.O_NOFOLLOW || !constants.O_NONBLOCK) {
    throw Error("Journal reads require POSIX no-follow support");
  }
  // Nonblocking mode lets a planted FIFO open at once, so the type check rejects it.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.uid !== process.geteuid() || file.nlink !== 1) {
      throw Error("Journal must be an operator-owned regular file with no hard links");
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    for (let read; length < buffer.length && (read = readSync(fd, buffer, length, buffer.length - length, null)) > 0;) {
      length += read;
    }
    if (length > maxBytes) throw Error("Journal exceeds the read limit");
    return JSON.parse(buffer.subarray(0, length).toString("utf8"));
  } finally {
    closeSync(fd);
  }
}

/** Replace a journal only after validating the opened file, without following symlinks. */
export function writeJournal(path: string, data: unknown): void {
  const body = JSON.stringify(data, null, 2) + "\n";
  if (!process.geteuid || !constants.O_NOFOLLOW || !constants.O_NONBLOCK) {
    throw Error("Journal writes require POSIX no-follow support");
  }
  // Do not truncate on open. Nonblocking mode also prevents a planted FIFO from hanging.
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.uid !== process.geteuid() || file.nlink !== 1) {
      throw Error("Journal must be an operator-owned regular file with no hard links");
    }
    fchmodSync(fd, 0o600);
    ftruncateSync(fd, 0);
    writeFileSync(fd, body);
  } finally {
    closeSync(fd);
  }
}
