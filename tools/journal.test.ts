import assert from "node:assert/strict";
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeJournal } from "./journal";

test("journals replace operator-owned files and keep private permissions", t => {
  const dir = mkdtempSync(join(tmpdir(), "namepass-journal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "journal.json");
  writeJournal(path, { entries: ["a longer previous record"] });
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  chmodSync(path, 0o666);
  writeJournal(path, { entries: [] });
  assert.equal(readFileSync(path, "utf8"), '{\n  "entries": []\n}\n');
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
});

test("symlinks and hard links cannot redirect a journal write", t => {
  const dir = mkdtempSync(join(tmpdir(), "namepass-journal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = join(dir, "operator-file");
  writeFileSync(target, "keep this content", { mode: 0o644 });
  chmodSync(target, 0o644);
  const symlink = join(dir, "symlink.json");
  const hardlink = join(dir, "hardlink.json");
  symlinkSync(target, symlink);
  linkSync(target, hardlink);
  for (const path of [symlink, hardlink]) {
    assert.throws(() => writeJournal(path, { entries: [] }));
    assert.equal(readFileSync(target, "utf8"), "keep this content");
    assert.equal(lstatSync(target).mode & 0o777, 0o644);
  }
  const missing = join(dir, "missing");
  const dangling = join(dir, "dangling.json");
  symlinkSync(missing, dangling);
  assert.throws(() => writeJournal(dangling, { entries: [] }));
  assert.throws(() => lstatSync(missing), { code: "ENOENT" });
});

test("foreign-owned files and directories are rejected before modification", t => {
  const dir = mkdtempSync(join(tmpdir(), "namepass-journal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "journal.json");
  writeFileSync(path, "keep this content", { mode: 0o644 });
  chmodSync(path, 0o644);
  const uid = process.geteuid!();
  t.mock.method(process as typeof process & { geteuid: () => number }, "geteuid", () => uid + 1);
  assert.throws(() => writeJournal(path, { entries: [] }), /operator-owned regular file/);
  assert.equal(readFileSync(path, "utf8"), "keep this content");
  assert.equal(lstatSync(path).mode & 0o777, 0o644);
  const directory = join(dir, "directory");
  mkdirSync(directory);
  assert.throws(() => writeJournal(directory, { entries: [] }));
  assert.ok(lstatSync(directory).isDirectory());
});
