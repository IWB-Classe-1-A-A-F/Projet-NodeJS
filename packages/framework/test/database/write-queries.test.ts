import { describe, expect, it } from "vitest";
import { deleteFrom, insertInto, QueryBuilderError, update, type Operator } from "../../src/index.ts";

describe("insertInto", () => {
  it("lie chaque valeur et renvoie les colonnes demandées", () => {
    const query = insertInto("journeys")
      .values({ title: "Alpes", visibility: "public", author_id: 3 })
      .returning("id", "created_at");

    expect(query.toSQL()).toEqual({
      text:
        'INSERT INTO "journeys" ("title", "visibility", "author_id") VALUES ($1, $2, $3) ' +
        'RETURNING "id", "created_at"',
      values: ["Alpes", "public", 3],
    });
  });

  it("renvoie toutes les colonnes avec returning() sans argument", () => {
    expect(insertInto("users").values({ email: "a@b.c" }).returning().toSQL().text).toBe(
      'INSERT INTO "users" ("email") VALUES ($1) RETURNING *',
    );
  });

  it("n'ajoute pas RETURNING si on ne le demande pas", () => {
    expect(insertInto("users").values({ email: "a@b.c" }).toSQL().text).toBe(
      'INSERT INTO "users" ("email") VALUES ($1)',
    );
  });

  it("ignore les valeurs undefined mais garde null", () => {
    const { text, values } = insertInto("journeys")
      .values({ title: "Alpes", summary: undefined, cover_path: null })
      .toSQL();

    expect(text).toBe('INSERT INTO "journeys" ("title", "cover_path") VALUES ($1, $2)');
    expect(values).toEqual(["Alpes", null]);
  });

  it("garde une valeur malveillante hors du texte SQL", () => {
    const attack = "x'); DROP TABLE users; --";
    const { text, values } = insertInto("comments").values({ content: attack }).toSQL();

    expect(text).not.toContain("DROP");
    expect(values).toEqual([attack]);
  });

  it("refuse un INSERT sans valeur", () => {
    expect(() => insertInto("users").toSQL()).toThrow(QueryBuilderError);
    expect(() => insertInto("users").values({ email: undefined }).toSQL()).toThrow(QueryBuilderError);
  });

  it("refuse un nom de colonne invalide, même venant d'une clé d'objet", () => {
    expect(() => insertInto("users").values({ 'role") VALUES (1); --': "admin" }).toSQL()).toThrow(
      QueryBuilderError,
    );
  });

  it("refuse une table ou une colonne RETURNING invalide", () => {
    expect(() => insertInto("users; --")).toThrow(QueryBuilderError);
    expect(() => insertInto("users").returning("id, password")).toThrow(QueryBuilderError);
  });
});

describe("update", () => {
  it("numérote SET puis WHERE et renvoie les colonnes demandées", () => {
    const query = update("journeys")
      .set({ title: "Alpes", visibility: "private" })
      .where("id", "=", 12)
      .where("author_id", "=", 3)
      .returning("id");

    expect(query.toSQL()).toEqual({
      text:
        'UPDATE "journeys" SET "title" = $1, "visibility" = $2 ' +
        'WHERE "id" = $3 AND "author_id" = $4 RETURNING "id"',
      values: ["Alpes", "private", 12, 3],
    });
  });

  it("fusionne plusieurs set() et ignore les undefined (mise à jour partielle)", () => {
    const { text, values } = update("journeys")
      .set({ title: "Alpes", summary: undefined })
      .set({ visibility: "public" })
      .where("id", "=", 1)
      .toSQL();

    expect(text).toBe('UPDATE "journeys" SET "title" = $1, "visibility" = $2 WHERE "id" = $3');
    expect(values).toEqual(["Alpes", "public", 1]);
  });

  it("refuse un UPDATE sans valeur", () => {
    expect(() => update("journeys").where("id", "=", 1).toSQL()).toThrow(QueryBuilderError);
  });

  it("refuse un UPDATE sans WHERE", () => {
    expect(() => update("journeys").set({ title: "x" }).toSQL()).toThrow(/sans WHERE/);
  });

  it("refuse un opérateur hors liste", () => {
    expect(() => update("journeys").where("id", "= 1 OR 1=1" as Operator, 1)).toThrow(QueryBuilderError);
  });
});

describe("deleteFrom", () => {
  it("supprime avec des conditions liées et RETURNING", () => {
    expect(deleteFrom("comments").where("id", "=", 5).where("author_id", "=", 3).returning().toSQL()).toEqual({
      text: 'DELETE FROM "comments" WHERE "id" = $1 AND "author_id" = $2 RETURNING *',
      values: [5, 3],
    });
  });

  it("n'ajoute pas RETURNING si on ne le demande pas", () => {
    expect(deleteFrom("comments").where("id", "=", 5).toSQL().text).toBe('DELETE FROM "comments" WHERE "id" = $1');
  });

  it("refuse un DELETE sans WHERE", () => {
    expect(() => deleteFrom("comments").toSQL()).toThrow(/sans WHERE/);
  });

  it("refuse une colonne de condition invalide", () => {
    expect(() => deleteFrom("comments").where("id; --", "=", 1)).toThrow(QueryBuilderError);
  });
});

describe("immuabilité", () => {
  it("ne modifie jamais la requête d'origine", () => {
    const base = update("journeys").set({ title: "A" });
    const withWhere = base.where("id", "=", 1);

    expect(() => base.toSQL()).toThrow(/sans WHERE/);
    expect(withWhere.toSQL().values).toEqual(["A", 1]);
    expect(withWhere).not.toBe(base);
  });
});