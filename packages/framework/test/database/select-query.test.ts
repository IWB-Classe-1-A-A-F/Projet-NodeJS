import { describe, expect, it } from "vitest";
import { from, QueryBuilderError, type Operator } from "../../src/index.ts";

describe("from / select", () => {
  it("sélectionne * quand aucune colonne n'est demandée", () => {
    expect(from("journeys").toSQL()).toEqual({ text: 'SELECT * FROM "journeys"', values: [] });
  });

  it("met les colonnes, la table et l'alias entre guillemets", () => {
    const query = from("journeys", "j").select("j.id", "j.title").selectAs("j.created_at", "createdAt");

    expect(query.toSQL().text).toBe(
      'SELECT "j"."id", "j"."title", "j"."created_at" AS "createdAt" FROM "journeys" AS "j"',
    );
  });
});

describe("where", () => {
  it("lie chaque valeur avec $1, $2... et combine avec AND", () => {
    const query = from("journeys").where("author_id", "=", 3).where("title", "ILIKE", "%alpes%");

    expect(query.toSQL()).toEqual({
      text: 'SELECT * FROM "journeys" WHERE "author_id" = $1 AND "title" ILIKE $2',
      values: [3, "%alpes%"],
    });
  });

  it("ne met jamais une valeur malveillante dans le texte SQL", () => {
    const attack = "1; DROP TABLE users; --";
    const { text, values } = from("users").where("id", "=", attack).toSQL();

    expect(text).not.toContain("DROP");
    expect(values).toEqual([attack]);
  });

  it("refuse un opérateur hors liste", () => {
    const operator = "= 1 OR 1=1 --" as Operator;

    expect(() => from("users").where("id", operator, 1)).toThrow(QueryBuilderError);
  });
});

describe("identifiants", () => {
  it.each([
    'id"; DROP TABLE users; --',
    "id desc",
    "1abc",
    "",
    "a.b.c",
    "users.",
  ])("refuse %j", (name) => {
    expect(() => from("users").select(name)).toThrow(QueryBuilderError);
  });

  it("refuse un nom de table ou d'alias invalide", () => {
    expect(() => from("users; --")).toThrow(QueryBuilderError);
    expect(() => from("users", "u u")).toThrow(QueryBuilderError);
  });

  it("donne un nom à l'erreur", () => {
    expect(() => from("1x")).toThrow(expect.objectContaining({ name: "QueryBuilderError" }));
  });
});

describe("immuabilité", () => {
  it("ne modifie jamais la requête d'origine", () => {
    const base = from("journeys");
    const filtered = base.where("visibility", "=", "public");

    expect(base.toSQL().text).toBe('SELECT * FROM "journeys"');
    expect(filtered.toSQL().values).toEqual(["public"]);
    expect(filtered).not.toBe(base);
  });
});