import { QueryBuilderError, quoteIdentifier } from "./identifiers.ts";

/** Requête prête pour pg : le SQL avec $1, $2... et les valeurs liées, séparément. */
export type CompiledQuery = {
  readonly text: string;
  readonly values: readonly unknown[];
};

export type Operator = "=" | "<>" | "<" | "<=" | ">" | ">=" | "LIKE" | "ILIKE";

const OPERATORS: ReadonlySet<string> = new Set(["=", "<>", "<", "<=", ">", ">=", "LIKE", "ILIKE"]);

type Condition = {
  readonly column: string; 
  readonly operator: Operator;
  readonly value: unknown;
};

type SelectState = {
  readonly from: string;
  readonly columns: readonly string[];
  readonly wheres: readonly Condition[];
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

  /** Ajoute une condition. Plusieurs where() sont combinés avec AND. La valeur est toujours liée. */
  where(column: string, operator: Operator, value: unknown): SelectQuery {
    if (!OPERATORS.has(operator)) {
      throw new QueryBuilderError(`Opérateur non autorisé : "${operator}"`);
    }
    return new SelectQuery({
      ...this.#state,
      wheres: [...this.#state.wheres, { column: quoteIdentifier(column), operator, value }],
    });
  }

  /** Produit le SQL et les valeurs. Aucune valeur n'est jamais concaténée dans le texte. */
  toSQL(): CompiledQuery {
    const { from, columns, wheres } = this.#state;
    const selectPart = columns.length === 0 ? "*" : columns.join(", ");
    const wherePart =
      wheres.length === 0
        ? ""
        : ` WHERE ${wheres.map((c, i) => `${c.column} ${c.operator} $${i + 1}`).join(" AND ")}`;

    return {
      text: `SELECT ${selectPart} FROM ${from}${wherePart}`,
      values: wheres.map((c) => c.value),
    };
  }
}

/** Point d'entrée : `from("journeys", "j").select("j.id").where("j.author_id", "=", 3)` */
export const from = (table: string, alias?: string): SelectQuery =>
  new SelectQuery({
    from: alias === undefined ? quoteIdentifier(table) : `${quoteIdentifier(table)} AS ${quoteIdentifier(alias)}`,
    columns: [],
    wheres: [],
  });