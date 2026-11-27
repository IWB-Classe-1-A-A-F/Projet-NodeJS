import { QueryBuilderError, quoteIdentifier } from "./identifiers.ts";
import {
  assertOperator,
  condition,
  conditions,
  type CompiledQuery,
  type Condition,
  type Operator,
} from "./sql-parts.ts";

export type Direction = "ASC" | "DESC";
export type AggregateFunction = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

const DIRECTIONS: ReadonlySet<string> = new Set(["ASC", "DESC"]);
const AGGREGATES: ReadonlySet<string> = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

type SelectState = {
  readonly from: string; // déjà validé et entre guillemets
  readonly columns: readonly string[];
  readonly joins: readonly string[];
  readonly wheres: readonly Condition[];
  readonly groups: readonly string[];
  readonly havings: readonly Condition[];
  readonly orders: readonly string[];
  readonly limit: number | undefined;
  readonly offset: number | undefined;
};

/** `"journeys" AS "j"` ou `"journeys"` */
const tableWithAlias = (table: string, alias: string | undefined): string =>
  alias === undefined ? quoteIdentifier(table) : `${quoteIdentifier(table)} AS ${quoteIdentifier(alias)}`;

/**
 * `COUNT(*)`, `COUNT(DISTINCT "s"."id")`, `SUM("price")`...
 * `*` n'est accepté qu'avec COUNT, sans DISTINCT.
 */
const aggregate = (fn: AggregateFunction, column: string, distinct: boolean): string => {
  if (!AGGREGATES.has(fn)) {
    throw new QueryBuilderError(`Fonction d'agrégation non autorisée : "${fn}"`);
  }
  if (column === "*") {
    if (fn !== "COUNT" || distinct) {
      throw new QueryBuilderError(`"*" n'est autorisé qu'avec COUNT, sans DISTINCT`);
    }
    return "COUNT(*)";
  }
  return `${fn}(${distinct ? "DISTINCT " : ""}${quoteIdentifier(column)})`;
};

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
    return new SelectQuery({ ...this.#state, wheres: [...this.#state.wheres, condition(column, operator, value)] });
  }

  /** Ajoute une colonne calculée : `COUNT(DISTINCT "s"."id") AS "step_count"`. */
  selectAggregate(fn: AggregateFunction, column: string, alias: string, distinct = false): SelectQuery {
    return new SelectQuery({
      ...this.#state,
      columns: [...this.#state.columns, `${aggregate(fn, column, distinct)} AS ${quoteIdentifier(alias)}`],
    });
  }

  /** Regroupe les lignes : obligatoire pour mélanger colonnes simples et agrégats. */
  groupBy(...columns: readonly string[]): SelectQuery {
    return new SelectQuery({
      ...this.#state,
      groups: [...this.#state.groups, ...columns.map(quoteIdentifier)],
    });
  }

  /** Condition sur un agrégat, après le regroupement : `HAVING COUNT(*) > $1`. La valeur est liée. */
  having(
    fn: AggregateFunction,
    column: string,
    operator: Operator,
    value: unknown,
    distinct = false,
  ): SelectQuery {
    assertOperator(operator);
    return new SelectQuery({
      ...this.#state,
      havings: [...this.#state.havings, { column: aggregate(fn, column, distinct), operator, value }],
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
    const { from, columns, joins, wheres, groups, havings, orders, limit, offset } = this.#state;

    // Les valeurs dans l'ordre où leurs $n apparaissent : WHERE, HAVING, LIMIT, OFFSET.
    const values: readonly unknown[] = [
      ...wheres.map((c) => c.value),
      ...havings.map((c) => c.value),
      ...(limit === undefined ? [] : [limit]),
      ...(offset === undefined ? [] : [offset]),
    ];
    const havingStart = wheres.length + 1;
    const limitIndex = havingStart + havings.length;
    const offsetIndex = limit === undefined ? limitIndex : limitIndex + 1;

    const parts = [
      `SELECT ${columns.length === 0 ? "*" : columns.join(", ")}`,
      `FROM ${from}`,
      ...joins,
      ...(wheres.length === 0 ? [] : [`WHERE ${conditions(wheres, 1)}`]),
      ...(groups.length === 0 ? [] : [`GROUP BY ${groups.join(", ")}`]),
      ...(havings.length === 0 ? [] : [`HAVING ${conditions(havings, havingStart)}`]),
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
    groups: [],
    havings: [],
    orders: [],
    limit: undefined,
    offset: undefined,
  });