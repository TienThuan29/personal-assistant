import { DatabaseSync } from 'node:sqlite';

it('runs on Electron Node with node:sqlite + FTS5', () => {
  expect(process.versions.electron).toBeDefined();
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='unicode61 remove_diacritics 2')");
  db.exec("INSERT INTO t VALUES ('xin chào thế giới')");
  expect(db.prepare("SELECT x FROM t WHERE t MATCH 'chao'").all()).toHaveLength(1);
});
