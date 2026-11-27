import { describe, expect, it } from "vitest";
import { from, QueryBuilderError, type AggregateFunction } from "../../src/index.ts";

describe("selectAggregate", () => {
  it("compte toutes les lignes avec COUNT(*)", () => {
    expect(from("journeys").selectAggregate("COUNT", "*", "total").toSQL()).toEqual({
      text: 'SELECT COUNT(*) AS "total" FROM "journeys"',
      values: [],
    });
  });

  it.each(["SUM", "AVG", "MIN", "MAX"] as const)("accepte %s sur une colonne", (fn) => {
    expect(from("steps").selectAggregate(fn, "position", "result").toSQL().text).toBe(
      `SELECT ${fn}("position") AS "result" FROM "steps"`,
    );
  });

  it("ajoute DISTINCT quand on le demande", () => {
    expect(from("journeys", "j").selectAggregate("COUNT", "s.id", "step_count", true).toSQL().text).toBe(
      'SELECT COUNT(DISTINCT "s"."id") AS "step_count" FROM "journeys" AS "j"',
    );
  });

  it("refuse * avec une autre fonction que COUNT, ou avec DISTINCT", () => {
    expect(() => from("steps").selectAggregate("SUM", "*", "x")).toThrow(QueryBuilderError);
    expect(() => from("steps").selectAggregate("COUNT", "*", "x", true)).toThrow(QueryBuilderError);
  });

  it("refuse une fonction hors liste", () => {
    const fn = "pg_sleep" as AggregateFunction;

    expect(() => from("steps").selectAggregate(fn, "id", "x")).toThrow(QueryBuilderError);
  });

  it("refuse une colonne ou un alias invalide", () => {
    expect(() => from("steps").selectAggregate("MAX", "id)); DROP TABLE users; --", "x")).toThrow(QueryBuilderError);
    expect(() => from("steps").selectAggregate("MAX", "id", "x y")).toThrow(QueryBuilderError);
  });
});

describe("groupBy", () => {
  it("regroupe sur une ou plusieurs colonnes", () => {
    const query = from("journeys", "j")
      .select("j.id", "j.title")
      .selectAggregate("COUNT", "s.id", "step_count")
      .leftJoin("steps", "s", "s.journey_id", "j.id")
      .groupBy("j.id", "j.title");

    expect(query.toSQL().text).toBe(
      'SELECT "j"."id", "j"."title", COUNT("s"."id") AS "step_count" FROM "journeys" AS "j" ' +
        'LEFT JOIN "steps" AS "s" ON "s"."journey_id" = "j"."id" GROUP BY "j"."id", "j"."title"',
    );
  });

  it("refuse une colonne de regroupement invalide", () => {
    expect(() => from("journeys").groupBy("id; --")).toThrow(QueryBuilderError);
  });
});

describe("having", () => {
  it("filtre sur un agrégat avec une valeur liée", () => {
    const query = from("comments").select("journey_id").groupBy("journey_id").having("COUNT", "*", ">=", 5);

    expect(query.toSQL()).toEqual({
      text: 'SELECT "journey_id" FROM "comments" GROUP BY "journey_id" HAVING COUNT(*) >= $1',
      values: [5],
    });
  });

  it("accepte DISTINCT et plusieurs conditions combinées avec AND", () => {
    const { text } = from("journeys", "j")
      .groupBy("j.id")
      .having("COUNT", "s.id", ">", 0, true)
      .having("MAX", "s.position", "<", 100)
      .toSQL();

    expect(text).toContain('HAVING COUNT(DISTINCT "s"."id") > $1 AND MAX("s"."position") < $2');
  });

  it("refuse un opérateur hors liste", () => {
    expect(() => from("comments").having("COUNT", "*", "> 0 OR 1=1" as ">", 1)).toThrow(QueryBuilderError);
  });

  it("numérote WHERE, puis HAVING, puis LIMIT et OFFSET", () => {
    const query = from("journeys", "j")
      .select("j.id")
      .selectAggregate("COUNT", "c.id", "comment_count", true)
      .leftJoin("comments", "c", "c.journey_id", "j.id")
      .where("j.visibility", "=", "public")
      .where("j.author_id", "=", 7)
      .groupBy("j.id")
      .having("COUNT", "c.id", ">", 2, true)
      .orderBy("comment_count", "DESC")
      .limit(10)
      .offset(20);

    expect(query.toSQL()).toEqual({
      text:
        'SELECT "j"."id", COUNT(DISTINCT "c"."id") AS "comment_count" FROM "journeys" AS "j" ' +
        'LEFT JOIN "comments" AS "c" ON "c"."journey_id" = "j"."id" ' +
        'WHERE "j"."visibility" = $1 AND "j"."author_id" = $2 GROUP BY "j"."id" ' +
        'HAVING COUNT(DISTINCT "c"."id") > $3 ORDER BY "comment_count" DESC LIMIT $4 OFFSET $5',
      values: ["public", 7, 2, 10, 20],
    });
  });
});