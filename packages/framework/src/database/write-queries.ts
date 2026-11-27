import { QueryBuilderError, quoteIdentifier } from "./identifiers.ts";
import {
  columnValues,
  condition,
  conditions,
  returningClause,
  type CompiledQuery,
  type Condition,
  type Operator,
} from "./sql-parts.ts";

type Row = Readonly<Record<string, unknown>>;

/** Valide les colonnes de RETURNING. */
const returningColumns = (columns: readonly string[]): readonly string[] => columns.map(quoteIdentifier);

// ---------------------------------------------------------------- INSERT

type InsertState = {
  readonly table: string;
  readonly row: Row;
  readonly returning: readonly string[] | undefined;
};

/** INSERT immuable : `insertInto("journeys").values({ title: "Alpes" }).returning("id")` */
export class InsertQuery {
  readonly #state: InsertState;

  constructor(state: InsertState) {
    this.#state = state;
  }

  /** Les colonnes à remplir. Une valeur `undefined` est ignorée : la base applique sa valeur par défaut. */
  values(row: Row): InsertQuery {
    return new InsertQuery({ ...this.#state, row });
  }

  /** Renvoie les lignes insérées. Sans argument : toutes les colonnes. */
  returning(...columns: readonly string[]): InsertQuery {
    return new InsertQuery({ ...this.#state, returning: returningColumns(columns) });
  }

  toSQL(): CompiledQuery {
    const entries = columnValues(this.#state.row);
    if (entries.length === 0) {
      throw new QueryBuilderError(`INSERT dans ${this.#state.table} sans aucune valeur`);
    }
    const parts = [
      `INSERT INTO ${this.#state.table}`,
      `(${entries.map(([column]) => column).join(", ")})`,
      `VALUES (${entries.map((_, i) => `$${i + 1}`).join(", ")})`,
      ...returningClause(this.#state.returning),
    ];
    return { text: parts.join(" "), values: entries.map(([, value]) => value) };
  }
}

export const insertInto = (table: string): InsertQuery =>
  new InsertQuery({ table: quoteIdentifier(table), row: {}, returning: undefined });

// ---------------------------------------------------------------- UPDATE

type UpdateState = {
  readonly table: string;
  readonly row: Row;
  readonly wheres: readonly Condition[];
  readonly returning: readonly string[] | undefined;
};

/** UPDATE immuable : `update("journeys").set({ title: "Alpes" }).where("id", "=", 3)` */
export class UpdateQuery {
  readonly #state: UpdateState;

  constructor(state: UpdateState) {
    this.#state = state;
  }

  /** Les colonnes à modifier. Une valeur `undefined` est ignorée : utile pour une mise à jour partielle. */
  set(row: Row): UpdateQuery {
    return new UpdateQuery({ ...this.#state, row: { ...this.#state.row, ...row } });
  }

  where(column: string, operator: Operator, value: unknown): UpdateQuery {
    return new UpdateQuery({ ...this.#state, wheres: [...this.#state.wheres, condition(column, operator, value)] });
  }

  returning(...columns: readonly string[]): UpdateQuery {
    return new UpdateQuery({ ...this.#state, returning: returningColumns(columns) });
  }

  toSQL(): CompiledQuery {
    const { table, row, wheres, returning } = this.#state;
    const entries = columnValues(row);
    if (entries.length === 0) {
      throw new QueryBuilderError(`UPDATE de ${table} sans aucune valeur`);
    }
    // Sécurité : un UPDATE sans WHERE modifierait toute la table.
    if (wheres.length === 0) {
      throw new QueryBuilderError(`UPDATE de ${table} sans WHERE refusé`);
    }
    const parts = [
      `UPDATE ${table}`,
      `SET ${entries.map(([column], i) => `${column} = $${i + 1}`).join(", ")}`,
      `WHERE ${conditions(wheres, entries.length + 1)}`,
      ...returningClause(returning),
    ];
    return {
      text: parts.join(" "),
      values: [...entries.map(([, value]) => value), ...wheres.map((c) => c.value)],
    };
  }
}

export const update = (table: string): UpdateQuery =>
  new UpdateQuery({ table: quoteIdentifier(table), row: {}, wheres: [], returning: undefined });

// ---------------------------------------------------------------- DELETE

type DeleteState = {
  readonly table: string;
  readonly wheres: readonly Condition[];
  readonly returning: readonly string[] | undefined;
};

/** DELETE immuable : `deleteFrom("comments").where("id", "=", 3)` */
export class DeleteQuery {
  readonly #state: DeleteState;

  constructor(state: DeleteState) {
    this.#state = state;
  }

  where(column: string, operator: Operator, value: unknown): DeleteQuery {
    return new DeleteQuery({ ...this.#state, wheres: [...this.#state.wheres, condition(column, operator, value)] });
  }

  returning(...columns: readonly string[]): DeleteQuery {
    return new DeleteQuery({ ...this.#state, returning: returningColumns(columns) });
  }

  toSQL(): CompiledQuery {
    const { table, wheres, returning } = this.#state;
    // Sécurité : un DELETE sans WHERE viderait toute la table.
    if (wheres.length === 0) {
      throw new QueryBuilderError(`DELETE de ${table} sans WHERE refusé`);
    }
    const parts = [`DELETE FROM ${table}`, `WHERE ${conditions(wheres, 1)}`, ...returningClause(returning)];
    return { text: parts.join(" "), values: wheres.map((c) => c.value) };
  }
}

export const deleteFrom = (table: string): DeleteQuery =>
  new DeleteQuery({ table: quoteIdentifier(table), wheres: [], returning: undefined });