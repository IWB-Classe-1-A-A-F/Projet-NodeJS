import { describe, expect, it } from "vitest";
import {
  createDatabase,
  DatabaseError,
  from,
  insertInto,
  openDatabase,
  PG_ERROR,
  readRow,
  update,
  type PoolClientLike,
  type PoolLike,
} from "../../src/index.ts";

type Call = { readonly text: string; readonly values: readonly unknown[] | undefined };

/** Faux pool : enregistre les requêtes et renvoie des lignes prévues, sans vraie base. */
const fakePool = (
  options: { readonly rows?: readonly unknown[]; readonly rowCount?: number | null; readonly failOn?: string } = {},
) => {
  const calls: Call[] = [];
  const state = { released: 0, ended: false };

  const query = async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    if (options.failOn !== undefined && text.startsWith(options.failOn)) {
      throw Object.assign(new Error("message interne du pilote"), { code: PG_ERROR.uniqueViolation });
    }
    return { rows: options.rows ?? [], rowCount: options.rowCount === undefined ? 1 : options.rowCount };
  };

  const client: PoolClientLike = { query, release: () => void state.released++ };
  const pool: PoolLike = {
    query,
    connect: async () => client,
    end: async () => {
      state.ended = true;
    },
  };
  return { pool, calls, state };
};

type Journey = { readonly id: number; readonly title: string };
const toJourney = (raw: unknown): Journey => {
  const row = readRow(raw);
  return { id: row.number("id"), title: row.string("title") };
};

describe("all / first / run", () => {
  it("envoie le SQL et les valeurs séparément, puis convertit chaque ligne", async () => {
    const { pool, calls } = fakePool({ rows: [{ id: 1, title: "Alpes" }, { id: "2", title: "Bretagne" }] });
    const db = createDatabase(pool);

    const journeys = await db.all(from("journeys").where("author_id", "=", 3), toJourney);

    expect(journeys).toEqual([
      { id: 1, title: "Alpes" },
      { id: 2, title: "Bretagne" },
    ]);
    expect(calls).toEqual([{ text: 'SELECT * FROM "journeys" WHERE "author_id" = $1', values: [3] }]);
  });

  it("first renvoie la première ligne ou undefined", async () => {
    const found = createDatabase(fakePool({ rows: [{ id: 7, title: "Jura" }] }).pool);
    const empty = createDatabase(fakePool({ rows: [] }).pool);

    expect(await found.first(from("journeys"), toJourney)).toEqual({ id: 7, title: "Jura" });
    expect(await empty.first(from("journeys"), toJourney)).toBeUndefined();
  });

  it("run renvoie le nombre de lignes touchées, 0 si pg n'en donne pas", async () => {
    const query = update("journeys").set({ title: "x" }).where("id", "=", 1);

    expect(await createDatabase(fakePool({ rowCount: 4 }).pool).run(query)).toBe(4);
    expect(await createDatabase(fakePool({ rowCount: null }).pool).run(query)).toBe(0);
  });

  it("transforme une erreur pg en DatabaseError sans exposer son message", async () => {
    const db = createDatabase(fakePool({ failOn: "INSERT" }).pool);

    const error: unknown = await db.run(insertInto("users").values({ email: "a@b.c" })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: PG_ERROR.uniqueViolation, message: "La requête a échoué" });
  });

  it("donne un code undefined si l'erreur n'en a pas", async () => {
    const pool: PoolLike = {
      ...fakePool().pool,
      query: () => Promise.reject(new Error("connexion perdue")),
    };

    await expect(createDatabase(pool).run(from("journeys"))).rejects.toMatchObject({ code: undefined });
  });

  it("refuse une ligne mal formée grâce au lecteur", async () => {
    const db = createDatabase(fakePool({ rows: [{ id: 1, title: 42 }] }).pool);

    await expect(db.all(from("journeys"), toJourney)).rejects.toThrow('Colonne "title"');
  });
});

describe("transaction", () => {
  it("fait BEGIN, les requêtes, puis COMMIT sur la même connexion, et la libère", async () => {
    const { pool, calls, state } = fakePool({ rows: [{ id: 9, title: "Alpes" }] });
    const db = createDatabase(pool);

    const result = await db.transaction(async (tx) => {
      const journey = await tx.first(insertInto("journeys").values({ title: "Alpes" }).returning(), toJourney);
      await tx.run(insertInto("steps").values({ journey_id: journey?.id, position: 1 }));
      return journey;
    });

    expect(result).toEqual({ id: 9, title: "Alpes" });
    expect(calls.map((c) => c.text.split(" ")[0])).toEqual(["BEGIN", "INSERT", "INSERT", "COMMIT"]);
    expect(state.released).toBe(1);
  });

  it("fait ROLLBACK, relance l'erreur et libère la connexion en cas d'échec", async () => {
    const { pool, calls, state } = fakePool({ failOn: "INSERT" });
    const db = createDatabase(pool);

    await expect(
      db.transaction((tx) => tx.run(insertInto("users").values({ email: "a@b.c" }))),
    ).rejects.toBeInstanceOf(DatabaseError);

    expect(calls.map((c) => c.text.split(" ")[0])).toEqual(["BEGIN", "INSERT", "ROLLBACK"]);
    expect(state.released).toBe(1);
  });

  it("fait aussi ROLLBACK si le code de l'application lève une erreur", async () => {
    const { pool, calls } = fakePool();
    const db = createDatabase(pool);

    await expect(
      db.transaction(async () => {
        throw new Error("règle métier violée");
      }),
    ).rejects.toThrow("règle métier violée");

    expect(calls.map((c) => c.text)).toEqual(["BEGIN", "ROLLBACK"]);
  });
});

describe("close et openDatabase", () => {
  it("close ferme le pool", async () => {
    const { pool, state } = fakePool();

    await createDatabase(pool).close();

    expect(state.ended).toBe(true);
  });

  it("openDatabase crée un vrai pool pg sans se connecter tant qu'aucune requête n'est faite", async () => {
    const db = openDatabase({ url: "postgres://user:pass@localhost:5432/test" });
    const withMax = openDatabase({ url: "postgres://user:pass@localhost:5432/test", maxConnections: 2 });

    await expect(db.close()).resolves.toBeUndefined();
    await expect(withMax.close()).resolves.toBeUndefined();
  });
});