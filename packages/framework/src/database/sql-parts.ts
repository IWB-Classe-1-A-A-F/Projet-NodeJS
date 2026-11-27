import { QueryBuilderError, quoteIdentifier } from "./identifiers.ts";

// Morceaux de SQL partagés par SELECT, INSERT, UPDATE et DELETE.

/** Requête prête pour pg : le SQL avec $1, $2... et les valeurs liées, séparément. */
export type CompiledQuery = {
  readonly text: string;
  readonly values: readonly unknown[];
};

export type Operator = "=" | "<>" | "<" | "<=" | ">" | ">=" | "LIKE" | "ILIKE";

const OPERATORS: ReadonlySet<string> = new Set(["=", "<>", "<", "<=", ">", ">=", "LIKE", "ILIKE"]);

/** Une comparaison simple, utilisée dans un groupe OR : `["title", "ILIKE", "%alpes%"]`. */
export type Comparison = readonly [column: string, operator: Operator, value: unknown];

/**
 * Une condition, sous l'une de ces formes (les colonnes sont déjà validées et entre guillemets) :
 * - compare : `"a" = $1`
 * - null    : `"a" IS NULL` ou `"a" IS NOT NULL`
 * - any     : `"a" = ANY($1)`, la liste entière est UNE seule valeur liée
 * - or      : `("a" ILIKE $1 OR "b" ILIKE $2)`
 */
export type Condition =
  | { readonly kind: "compare"; readonly column: string; readonly operator: Operator; readonly value: unknown }
  | { readonly kind: "null"; readonly column: string; readonly isNull: boolean }
  | { readonly kind: "any"; readonly column: string; readonly values: readonly unknown[] }
  | { readonly kind: "or"; readonly items: readonly Condition[] };

export const assertOperator = (operator: string): void => {
  // Le type empêche déjà un mauvais opérateur, mais un opérateur peut venir d'une donnée externe.
  if (!OPERATORS.has(operator)) {
    throw new QueryBuilderError(`Opérateur non autorisé : "${operator}"`);
  }
};

/** `"colonne" opérateur $n` */
export const condition = (column: string, operator: Operator, value: unknown): Condition => {
  assertOperator(operator);
  return { kind: "compare", column: quoteIdentifier(column), operator, value };
};

/** `"colonne" IS NULL` ou `IS NOT NULL` : aucune valeur à lier. */
export const nullCondition = (column: string, isNull: boolean): Condition => ({
  kind: "null",
  column: quoteIdentifier(column),
  isNull,
});

/** `"colonne" = ANY($n)` : équivalent de IN, et une liste vide ne renvoie simplement rien. */
export const anyCondition = (column: string, values: readonly unknown[]): Condition => {
  if (!Array.isArray(values)) {
    throw new QueryBuilderError(`IN sur "${column}" : une liste de valeurs est attendue`);
  }
  return { kind: "any", column: quoteIdentifier(column), values };
};

/** `(a OR b OR c)` : au moins une des comparaisons doit être vraie. */
export const orCondition = (comparisons: readonly Comparison[]): Condition => {
  if (comparisons.length === 0) {
    throw new QueryBuilderError("Un groupe OR doit contenir au moins une condition");
  }
  return { kind: "or", items: comparisons.map(([column, operator, value]) => condition(column, operator, value)) };
};

type Rendered = { readonly text: string; readonly values: readonly unknown[] };

const renderOne = (c: Condition, start: number): Rendered => {
  switch (c.kind) {
    case "compare":
      return { text: `${c.column} ${c.operator} $${start}`, values: [c.value] };
    case "null":
      return { text: `${c.column} IS ${c.isNull ? "" : "NOT "}NULL`, values: [] };
    case "any":
      return { text: `${c.column} = ANY($${start})`, values: [c.values] };
    case "or": {
      const group = renderConditions(c.items, start, " OR ");
      return { text: `(${group.text})`, values: group.values };
    }
  }
};

/**
 * Assemble les conditions et numérote les $n à partir de `start`.
 * Le nombre de valeurs varie selon la forme (0 pour IS NULL, plusieurs pour un OR),
 * donc chaque condition commence là où la précédente s'est arrêtée.
 */
export const renderConditions = (list: readonly Condition[], start: number, separator = " AND "): Rendered => {
  const parts = list.reduce<{ readonly texts: readonly string[]; readonly values: readonly unknown[] }>(
    (acc, c) => {
      const rendered = renderOne(c, start + acc.values.length);
      return { texts: [...acc.texts, rendered.text], values: [...acc.values, ...rendered.values] };
    },
    { texts: [], values: [] },
  );
  return { text: parts.texts.join(separator), values: parts.values };
};

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