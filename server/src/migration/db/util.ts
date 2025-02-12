import type { Migration } from 'kysely';
import { CompiledQuery, type Kysely } from 'kysely';
import fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { isNonEmptyString } from '../../util/index.ts';

export interface TunarrDBMigration extends Migration {
  fullCopy: boolean;
}

export async function columnExists(
  db: Kysely<unknown>,
  tableName: string,
  colName: string,
): Promise<boolean> {
  const tables = await db.introspection.getTables();
  return (
    tables
      .find((table) => table.name === tableName)
      ?.columns.some((col) => col.name === colName) ?? false
  );
}

export async function processSqlMigrationFile(
  filePath: string,
  statementBreakpoint: string = '--> statement-breakpoint',
) {
  const contents = await fs.readFile(
    path.join(dirname(fileURLToPath(import.meta.url)), filePath),
    'utf-8',
  );

  return contents
    .split(statementBreakpoint)
    .map((s) => s.trim())
    .filter(isNonEmptyString)
    .map((s) => CompiledQuery.raw(s));
}

export function makeKyselyMigrationFromSqlFile(
  filePath: string,
  fullCopy: boolean = false,
): TunarrDBMigration {
  return {
    fullCopy,
    async up(db) {
      for (const statement of await processSqlMigrationFile(filePath)) {
        await db.executeQuery(statement);
      }
    },
  };
}
