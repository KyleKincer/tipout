import type { PrismaClient } from "@prisma/client";
import { TABLES, SPECS, MAX_ROWS, canonical, emptyTables, fieldsFor, requireSafe, sealSnapshot, sha256 } from "./backfill";
import type { Row, Snapshot, SourceIdentity, Table } from "./backfill";

type Column = { table_name: string; column_name: string; data_type: string; datetime_precision: number | null };
export function validateSourceColumns(columns: Column[]): void {
  requireSafe(!columns.some(c => c.table_name === "RoleConfiguration"), "Older RoleConfiguration schema detected; review/export it separately before using this four-entity importer");
  for (const table of TABLES) {
    const spec = SPECS[table];
    const actual = columns.filter(c => c.table_name === spec.model);
    requireSafe(canonical(actual.map(c => c.column_name).sort()) === canonical(fieldsFor(table)), `Source schema drift in ${table}; no unknown columns are discarded`);
    for (const column of actual) {
      const expected = [...spec.dates, ...spec.nullableDates].includes(column.column_name) ? "timestamp without time zone"
        : (spec.decimals as string[]).includes(column.column_name) ? "numeric"
        : (spec.booleans as string[]).includes(column.column_name) ? "boolean" : "text";
      requireSafe(column.data_type === expected, `Unexpected source column type in ${table}`);
      if (expected === "timestamp without time zone") requireSafe(column.datetime_precision !== null && column.datetime_precision <= 3,
        "Source timestamp precision exceeds Convex millisecond precision; export cannot silently truncate");
    }
  }
}
const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
export function selectSourceSql(table: Table, schema: string): string {
  const spec = SPECS[table];
  const dates: string[] = [...spec.dates, ...spec.nullableDates];
  const decimals: string[] = spec.decimals;
  const fields = fieldsFor(table).map(field => {
    const name = quote(field);
    if (decimals.includes(field)) return `${name}::text AS ${name}`;
    // Prisma's current schema uses timestamp(3) without time zone. Values are
    // application UTC instants; there is no date-to-midnight normalization.
    if (dates.includes(field)) return `to_char(${name}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${name}`;
    return name;
  });
  return `SELECT ${fields.join(", ")} FROM ${quote(schema)}.${quote(spec.model)} ORDER BY "id" COLLATE "C"`;
}

export async function exportSource(prisma: PrismaClient, source: SourceIdentity): Promise<Snapshot> {
  return await prisma.$transaction(async tx => {
    // Must be the first SQL in this transaction. REPEATABLE READ provides one
    // MVCC snapshot across every count/schema/table read, even with live writes.
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const [meta] = await tx.$queryRawUnsafe<Array<{ database: string; schema: string; readOnly: string; isolation: string; capturedAt: string; postgresSnapshot: string }>>(
      `SELECT current_database() AS database, current_schema() AS schema,
        current_setting('transaction_read_only') AS "readOnly",
        current_setting('transaction_isolation') AS isolation,
        to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "capturedAt",
        txid_current_snapshot()::text AS "postgresSnapshot"`,
    );
    requireSafe(meta?.readOnly === "on" && meta.isolation === "repeatable read", "Source transaction is not read-only repeatable-read");
    requireSafe(meta.database === source.database && meta.schema === source.schema, "Connected source database/schema differs from explicit connection identity");
    const columns = await tx.$queryRawUnsafe<Column[]>(
      `SELECT table_name, column_name, data_type, datetime_precision FROM information_schema.columns
       WHERE table_schema = $1 AND table_name IN ('Role','Employee','RoleConfig','Shift','RoleConfiguration')`, source.schema,
    );
    validateSourceColumns(columns);
    const tables = emptyTables();
    let total = 0;
    for (const table of TABLES) {
      // Identifiers come only from fixed specs and correctly quoted schema;
      // never interpolate row values into SQL.
      const [count] = await tx.$queryRawUnsafe<Array<{ count: string }>>(`SELECT count(*)::text AS count FROM ${quote(source.schema)}.${quote(SPECS[table].model)}`);
      total += Number(count.count);
      requireSafe(Number.isSafeInteger(total) && total <= MAX_ROWS, "Source exceeds supported 100,000-row in-memory safety limit");
      tables[table] = await tx.$queryRawUnsafe<Row[]>(selectSourceSql(table, source.schema));
      requireSafe(tables[table].length === Number(count.count), "Source snapshot row count changed unexpectedly");
    }
    // Archive first even when a value cannot be represented in Convex. The
    // runner validates conversions after writing the untouched raw archive.
    return sealSnapshot({ version: 1, source, sourceFingerprint: sha256(canonical(source)), capturedAt: meta.capturedAt, postgresSnapshot: meta.postgresSnapshot, tables });
  }, { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 300_000 });
}
