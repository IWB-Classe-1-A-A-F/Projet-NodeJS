import pg from "pg";
import { DatabaseError } from "./rows.ts";
import type { CompiledQuery } from "./sql-parts.ts";

/** Tout ce qui sait se transformer en SQL : SelectQuery, InsertQuery, UpdateQuery, DeleteQuery. */
export type Buildable = { readonly toSQL: () => CompiledQuery };

/** Convertit une ligne brute (`unknown`) en objet typé. */
export type RowMapper<T> = (row: unknown) => T;

/** Ce qu'on peut faire avec une connexion, dans une transaction ou non. */
export type Executor = {
  /** Toutes les lignes, converties. */
  readonly all: <T>(query: Buildable, map: RowMapper<T>) => Promise<readonly T[]>;
  /** La première ligne, convertie, ou `undefined` s'il n'y en a pas. */
  readonly first: <T>(query: Buildable, map: RowMapper<T>) => Promise<T | undefined>;
  /** Exécute sans lire de ligne et renvoie le nombre de lignes touchées. */
  readonly run: (query: Buildable) => Promise<number>;
};

export type Database = Executor & {
  /** Exécute `work` dans une transaction : COMMIT si tout réussit, ROLLBACK à la moindre erreur. */
  readonly transaction: <T>(work: (tx: Executor) => Promise<T>) => Promise<T>;
  /** Ferme toutes les connexions (arrêt propre du kernel,. */
  readonly close: () => Promise<void>;
};

// Le strict minimum de pg dont on a besoin : un vrai pg.Pool convient, un faux aussi pour les tests.
type QueryResultLike = { readonly rows: readonly unknown[]; readonly rowCount: number | null };
type ClientLike = {
  query: (text: string, values?: unknown[]) => Promise<QueryResultLike>;
};
export type PoolClientLike = ClientLike & { release: () => void };
export type PoolLike = ClientLike & {
  connect: () => Promise<PoolClientLike>;
  end: () => Promise<void>;
};

/** Récupère le code SQLSTATE d'une erreur pg, sans faire confiance à sa forme. */
const pgCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

/** Construit les trois opérations sur une connexion (pool ou client de transaction). */
const executorFor = (connection: ClientLike): Executor => {
  const execute = async (query: Buildable): Promise<QueryResultLike> => {
    const { text, values } = query.toSQL();
    try {
      return await connection.query(text, [...values]);
    } catch (error) {
      // Le message du pilote reste dans `cause`, jamais dans le message exposé.
      throw new DatabaseError("La requête a échoué", pgCode(error), { cause: error });
    }
  };

  return {
    all: async (query, map) => (await execute(query)).rows.map(map),
    first: async (query, map) => {
      const [row] = (await execute(query)).rows;
      return row === undefined ? undefined : map(row);
    },
    run: async (query) => (await execute(query)).rowCount ?? 0,
  };
};

/** Crée la base à partir d'un pool existant (utilisé par les tests avec un faux pool). */
export const createDatabase = (pool: PoolLike): Database => ({
  ...executorFor(pool),

  transaction: async (work) => {
    // Une transaction doit utiliser UNE seule connexion du début à la fin.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(executorFor(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  close: () => pool.end(),
});

/** Ouvre la base : le Query Builder gère lui-même ses connexions. */
export const openDatabase = (options: { readonly url: string; readonly maxConnections?: number }): Database =>
  createDatabase(new pg.Pool({ connectionString: options.url, max: options.maxConnections ?? 10 }));