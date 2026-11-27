import { QueryBuilderError, quoteIdentifier } from "./identifiers.ts";

/** Requête prête pour pg : le SQL avec $1, $2... et les valeurs liées, séparément. */
export type CompiledQuery = {
  readonly text: string;
  readonly values: readonly unknown[];
};

export type Operator = "=" | "<>" | "<" | "<=" | ">" | ">=" | "LIKE" | "ILIKE";
export type Direction = "ASC" | "DESC";

const OPERATORS: ReadonlySet<string> = new Set(["=", "<>", "<", "<=", ">", ">=", "LIKE", "ILIKE"]);
const DIRECTIONS: ReadonlySet<string> = new Set(["ASC", "DESC"]);

type Condition = {
  readonly column: string; // déjà validé et entre guillemets
  readonly operator: Operator;
  readonly value: unknown;
};

type SelectState = {
  readonly from: string; // déjà validé et entre guillemets
  readonly columns: readonly string[];
  readonly joins: readonly string[];
  readonly wheres: readonly Condition[];
  readonly orders: readonly string[];
  readonly limit: number | undefined;
  readonly offset: number | undefined;
};

/** `"journeys" AS "j"` ou `"journeys"` */
const tableWithAlias = (table: string, alias: string | undefined): string =>
  alias === undefined ? quoteIdentifier(table) : `${quoteIdentifier(table)} AS ${quoteIdentifier(alias)}`;

/** LIMIT et OFFSET doivent être des entiers positifs ou nuls. */
const assertCount = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new QueryBuilderError(`${name} doit être un entier positif ou nul : ${value}`);
  }
};

/**
 * Requête SELECT immuable : chaque méthode renvoie une NOUVELLE requête,
 * l'originale n'est jamais modifiée.
 */
export class SelectQuery {
  readonly #state: SelectState;

  constructor(state: SelectState) {
    this.#state = state;
  }

  /** Ajoute des colonnes. Sans appel à select(), la requête sélectionne `*`. */
  select(...columns: readonly string[]): SelectQuery {
    return new SelectQuery({
      ...this.#state,
      columns: [...this.#state.columns, ...columns.map(quoteIdentifier)],
    });
  }

  /** Ajoute une colonne renommée : `"u"."display_name" AS "author"`. */
  selectAs(column: string, alias: string): SelectQuery {
    return new SelectQuery({
      ...this.#state,
      columns: [...this.#state.columns, `${quoteIdentifier(column)} AS ${quoteIdentifier(alias)}`],
    });
  }

  /** Jointure interne : ne garde que les lignes qui ont une correspondance des deux côtés. */
  join(table: string, alias: string | undefined, left: string, right: string): SelectQuery {
    return this.#addJoin("INNER JOIN", table, alias, left, right);
  }

  /** Jointure externe gauche : garde toutes les lignes de gauche, même sans correspondance. */
  leftJoin(table: string, alias: string | undefined, left: string, right: string): SelectQuery {
    return this.#addJoin("LEFT JOIN", table, alias, left, right);
  }

  /** La condition de jointure compare toujours deux colonnes : jamais de chaîne SQL libre. */
  #addJoin(kind: string, table: string, alias: string | undefined, left: string, right: string): SelectQuery {
    const join = `${kind} ${tableWithAlias(table, alias)} ON ${quoteIdentifier(left)} = ${quoteIdentifier(right)}`;
    return new SelectQuery({ ...this.#state, joins: [...this.#state.joins, join] });
  }

  /** Ajoute une condition. Plusieurs where() sont combinés avec AND. La valeur est toujours liée. */
  where(column: string, operator: Operator, value: unknown): SelectQuery {
    // Le type empêche déjà un mauvais opérateur, mais un opérateur peut venir d'une donnée externe.
    if (!OPERATORS.has(operator)) {
      throw new QueryBuilderError(`Opérateur non autorisé : "${operator}"`);
    }
    return new SelectQuery({
      ...this.#state,
      wheres: [...this.#state.wheres, { column: quoteIdentifier(column), operator, value }],
    });
  }

  /** Ajoute un critère de tri. Plusieurs orderBy() s'enchaînent dans l'ordre d'appel. */
  orderBy(column: string, direction: Direction = "ASC"): SelectQuery {
    if (!DIRECTIONS.has(direction)) {
      throw new QueryBuilderError(`Sens de tri non autorisé : "${direction}"`);
    }
    return new SelectQuery({
      ...this.#state,
      orders: [...this.#state.orders, `${quoteIdentifier(column)} ${direction}`],
    });
  }

  /** Nombre maximum de lignes. La valeur est liée, car elle vient souvent du client. */
  limit(count: number): SelectQuery {
    assertCount("LIMIT", count);
    return new SelectQuery({ ...this.#state, limit: count });
  }

  /** Nombre de lignes à sauter. La valeur est liée, car elle vient souvent du client. */
  offset(count: number): SelectQuery {
    assertCount("OFFSET", count);
    return new SelectQuery({ ...this.#state, offset: count });
  }

  /** Produit le SQL et les valeurs. Aucune valeur n'est jamais concaténée dans le texte. */
  toSQL(): CompiledQuery {
    const { from, columns, joins, wheres, orders, limit, offset } = this.#state;

    // Les valeurs dans l'ordre où leurs $n apparaissent : WHERE, puis LIMIT, puis OFFSET.
    const values: readonly unknown[] = [
      ...wheres.map((c) => c.value),
      ...(limit === undefined ? [] : [limit]),
      ...(offset === undefined ? [] : [offset]),
    ];
    const limitIndex = wheres.length + 1;
    const offsetIndex = limit === undefined ? limitIndex : limitIndex + 1;

    const parts = [
      `SELECT ${columns.length === 0 ? "*" : columns.join(", ")}`,
      `FROM ${from}`,
      ...joins,
      ...(wheres.length === 0
        ? []
        : [`WHERE ${wheres.map((c, i) => `${c.column} ${c.operator} $${i + 1}`).join(" AND ")}`]),
      ...(orders.length === 0 ? [] : [`ORDER BY ${orders.join(", ")}`]),
      ...(limit === undefined ? [] : [`LIMIT $${limitIndex}`]),
      ...(offset === undefined ? [] : [`OFFSET $${offsetIndex}`]),
    ];

    return { text: parts.join(" "), values };
  }
}

/** Point d'entrée : `from("journeys", "j").select("j.id").where("j.author_id", "=", 3)` */
export const from = (table: string, alias?: string): SelectQuery =>
  new SelectQuery({
    from: tableWithAlias(table, alias),
    columns: [],
    joins: [],
    wheres: [],
    orders: [],
    limit: undefined,
    offset: undefined,
  });