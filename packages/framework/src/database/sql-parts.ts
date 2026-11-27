import { QueryBuilderError, quoteIdentifier } from "./identifiers.ts";

// Morceaux de SQL partagés par SELECT, INSERT, UPDATE et DELETE.

/** Requête prête pour pg : le SQL avec $1, $2... et les valeurs liées, séparément. */
export type CompiledQuery = {
  readonly text: string;
  readonly values: readonly unknown[];
};

export type Operator = "=" | "<>" | "<" | "<=" | ">" | ">=" | "LIKE" | "ILIKE";

const OPERATORS: ReadonlySet<string> = new Set(["=", "<>", "<", "<=", ">", ">=", "LIKE", "ILIKE"]);

export type Condition = {
  readonly column: string; // colonne ou agrégat, déjà validé et entre guillemets
  readonly operator: Operator;
  readonly value: unknown;
};

export const assertOperator = (operator: string): void => {
  // Le type empêche déjà un mauvais opérateur, mais un opérateur peut venir d'une donnée externe.
  if (!OPERATORS.has(operator)) {
    throw new QueryBuilderError(`Opérateur non autorisé : "${operator}"`);
  }
};

/** Construit une condition sur une colonne, après validation de l'opérateur et du nom. */
export const condition = (column: string, operator: Operator, value: unknown): Condition => {
  assertOperator(operator);
  return { column: quoteIdentifier(column), operator, value };
};

/** Numérote les conditions à partir de $start : `"a" = $1 AND "b" > $2` */
export const conditions = (list: readonly Condition[], start: number): string =>
  list.map((c, i) => `${c.column} ${c.operator} $${start + i}`).join(" AND ");

/** Garde les paires clé/valeur dont la valeur est définie, avec la colonne validée. */
export const columnValues = (
  data: Readonly<Record<string, unknown>>,
): readonly (readonly [string, unknown])[] =>
  Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([column, value]) => [quoteIdentifier(column), value] as const);

/** `RETURNING *` sans argument, sinon `RETURNING "id", "title"`. */
export const returningClause = (columns: readonly string[] | undefined): readonly string[] =>
  columns === undefined ? [] : [`RETURNING ${columns.length === 0 ? "*" : columns.join(", ")}`];