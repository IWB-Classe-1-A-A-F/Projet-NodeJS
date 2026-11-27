/** Erreur levée par la couche base de données. Ne contient jamais le message du pilote. */
export class DatabaseError extends Error {
  /** Code SQLSTATE de PostgreSQL, par exemple "23505" pour une violation d'unicité. */
  readonly code: string | undefined;

  constructor(message: string, code?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseError";
    this.code = code;
  }
}

/** Les codes PostgreSQL utiles à l'application. */
export const PG_ERROR = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
} as const;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Lecteur de ligne : une ligne renvoyée par la base est `unknown`.
 * Chaque lecture vérifie le type avant de le renvoyer, sinon elle lève une DatabaseError.
 */
export type RowReader = {
  readonly string: (column: string) => string;
  readonly stringOrNull: (column: string) => string | null;
  readonly number: (column: string) => number;
  readonly boolean: (column: string) => boolean;
  readonly date: (column: string) => Date;
  readonly dateOrNull: (column: string) => Date | null;
};

export const readRow = (row: unknown): RowReader => {
  if (!isRecord(row)) {
    throw new DatabaseError("Ligne de résultat invalide");
  }

  const wrongType = (column: string, expected: string): DatabaseError =>
    new DatabaseError(`Colonne "${column}" : ${expected} attendu`);

  const string = (column: string): string => {
    const value = row[column];
    if (typeof value !== "string") throw wrongType(column, "texte");
    return value;
  };

  const date = (column: string): Date => {
    const value = row[column];
    if (!(value instanceof Date)) throw wrongType(column, "date");
    return value;
  };

  return {
    string,
    stringOrNull: (column) => (row[column] === null ? null : string(column)),
    number: (column) => {
      const value = row[column];
      // pg renvoie BIGINT et NUMERIC (donc COUNT(*)) sous forme de texte pour ne pas perdre de précision.
      const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof parsed !== "number" || !Number.isFinite(parsed)) throw wrongType(column, "nombre");
      return parsed;
    },
    boolean: (column) => {
      const value = row[column];
      if (typeof value !== "boolean") throw wrongType(column, "booléen");
      return value;
    },
    date,
    dateOrNull: (column) => (row[column] === null ? null : date(column)),
  };
};