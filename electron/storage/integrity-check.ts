import type { DatabaseConnection } from './database';

type Row = Record<string, unknown>;

export type ForeignKeyViolation = {
  table: string;
  parent: string;
  foreignKeyId: number;
};

export type DatabaseIntegrityResult = {
  ok: boolean;
  quickCheck: string[];
  foreignKeyViolations: ForeignKeyViolation[];
};

export function checkDatabaseIntegrity(db: DatabaseConnection): DatabaseIntegrityResult {
  const quickCheck = (db.prepare('PRAGMA quick_check').all() as Row[])
    .map((row) => String(row.quick_check ?? Object.values(row)[0] ?? 'unknown'));
  const foreignKeyViolations = (db.prepare('PRAGMA foreign_key_check').all() as Row[])
    .map((row) => ({
      table: String(row.table),
      parent: String(row.parent),
      foreignKeyId: Number(row.fkid),
    }));
  return {
    ok: quickCheck.length === 1 && quickCheck[0] === 'ok' && foreignKeyViolations.length === 0,
    quickCheck,
    foreignKeyViolations,
  };
}
