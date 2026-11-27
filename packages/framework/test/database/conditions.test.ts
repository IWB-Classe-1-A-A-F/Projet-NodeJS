import { describe, expect, it } from "vitest";
import { deleteFrom, from, QueryBuilderError, update, type Comparison, type Operator } from "../../src/index.ts";

describe("whereNull / whereNotNull", () => {
  it("ajoute IS NULL et IS NOT NULL sans valeur liée", () => {
    expect(from("comments").whereNull("deleted_at").whereNotNull("content").toSQL()).toEqual({
      text: 'SELECT * FROM "comments" WHERE "deleted_at" IS NULL AND "content" IS NOT NULL',
      values: [],
    });
  });

  it("refuse une colonne invalide", () => {
    expect(() => from("comments").whereNull("deleted_at; --")).toThrow(QueryBuilderError);
  });
});

describe("whereIn", () => {
  it("lie toute la liste comme UNE seule valeur avec = ANY", () => {
    expect(from("steps").whereIn("journey_id", [1, 2, 3]).toSQL()).toEqual({
      text: 'SELECT * FROM "steps" WHERE "journey_id" = ANY($1)',
      values: [[1, 2, 3]],
    });
  });

  it("accepte une liste vide (aucune ligne ne correspondra)", () => {
    expect(from("steps").whereIn("journey_id", []).toSQL().values).toEqual([[]]);
  });

  it("refuse autre chose qu'une liste", () => {
    const notAList = "1, 2); DROP TABLE steps; --" as unknown as readonly unknown[];

    expect(() => from("steps").whereIn("journey_id", notAList)).toThrow(QueryBuilderError);
  });
});

describe("whereAny", () => {
  it("met les comparaisons entre parenthèses, reliées par OR", () => {
    const search = "%alpes%";

    expect(
      from("journeys")
        .where("visibility", "=", "public")
        .whereAny([
          ["title", "ILIKE", search],
          ["summary", "ILIKE", search],
        ])
        .toSQL(),
    ).toEqual({
      text: 'SELECT * FROM "journeys" WHERE "visibility" = $1 AND ("title" ILIKE $2 OR "summary" ILIKE $3)',
      values: ["public", search, search],
    });
  });

  it("refuse un groupe vide", () => {
    expect(() => from("journeys").whereAny([])).toThrow(QueryBuilderError);
  });

  it("refuse un opérateur ou une colonne invalide dans le groupe", () => {
    const badOperator: Comparison = ["title", "= 1 OR 1=1" as Operator, "x"];

    expect(() => from("journeys").whereAny([badOperator])).toThrow(QueryBuilderError);
    expect(() => from("journeys").whereAny([["title)--", "=", "x"]])).toThrow(QueryBuilderError);
  });
});

describe("numérotation avec des formes mélangées", () => {
  it("SELECT : IS NULL ne consomme pas de $n, IN en consomme un, OR un par comparaison", () => {
    const query = from("journeys", "j")
      .whereNull("j.deleted_at")
      .whereIn("j.author_id", [3, 4])
      .whereAny([
        ["j.title", "ILIKE", "%a%"],
        ["j.summary", "ILIKE", "%a%"],
      ])
      .where("j.visibility", "=", "public")
      .groupBy("j.id")
      .having("COUNT", "*", ">", 0)
      .limit(10)
      .offset(20);

    expect(query.toSQL()).toEqual({
      text:
        'SELECT * FROM "journeys" AS "j" WHERE "j"."deleted_at" IS NULL AND "j"."author_id" = ANY($1) ' +
        'AND ("j"."title" ILIKE $2 OR "j"."summary" ILIKE $3) AND "j"."visibility" = $4 ' +
        'GROUP BY "j"."id" HAVING COUNT(*) > $5 LIMIT $6 OFFSET $7',
      values: [[3, 4], "%a%", "%a%", "public", 0, 10, 20],
    });
  });

  it("UPDATE : la suppression logique d'un commentaire non encore supprimé", () => {
    const deletedAt = new Date("2026-11-27T10:00:00Z");
    const query = update("comments")
      .set({ deleted_at: deletedAt })
      .where("id", "=", 5)
      .whereNull("deleted_at")
      .whereIn("author_id", [3])
      .whereAny([["journey_id", "=", 1]])
      .whereNotNull("content");

    expect(query.toSQL()).toEqual({
      text:
        'UPDATE "comments" SET "deleted_at" = $1 WHERE "id" = $2 AND "deleted_at" IS NULL ' +
        'AND "author_id" = ANY($3) AND ("journey_id" = $4) AND "content" IS NOT NULL',
      values: [deletedAt, 5, [3], 1],
    });
  });

  it("DELETE : accepte les mêmes formes", () => {
    const query = deleteFrom("steps")
      .whereIn("id", [7, 8])
      .whereNull("photo_path")
      .whereNotNull("journey_id")
      .whereAny([
        ["position", "<", 0],
        ["position", ">", 100],
      ]);

    expect(query.toSQL()).toEqual({
      text:
        'DELETE FROM "steps" WHERE "id" = ANY($1) AND "photo_path" IS NULL AND "journey_id" IS NOT NULL ' +
        'AND ("position" < $2 OR "position" > $3)',
      values: [[7, 8], 0, 100],
    });
  });
});