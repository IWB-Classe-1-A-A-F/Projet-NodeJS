import { describe, expect, it } from "vitest";
import { from, QueryBuilderError, type Direction } from "../../src/index.ts";

describe("jointures", () => {
  it("fait une jointure interne avec alias", () => {
    const query = from("journeys", "j").select("j.title", "u.display_name").join("users", "u", "u.id", "j.author_id");

    expect(query.toSQL().text).toBe(
      'SELECT "j"."title", "u"."display_name" FROM "journeys" AS "j" INNER JOIN "users" AS "u" ON "u"."id" = "j"."author_id"',
    );
  });

  it("fait une jointure externe gauche sans alias", () => {
    const query = from("journeys").leftJoin("steps", undefined, "steps.journey_id", "journeys.id");

    expect(query.toSQL().text).toBe(
      'SELECT * FROM "journeys" LEFT JOIN "steps" ON "steps"."journey_id" = "journeys"."id"',
    );
  });

  it("enchaîne plusieurs jointures dans l'ordre d'appel", () => {
    const { text } = from("comments", "c")
      .join("journeys", "j", "j.id", "c.journey_id")
      .leftJoin("users", "u", "u.id", "c.author_id")
      .toSQL();

    expect(text).toContain('INNER JOIN "journeys" AS "j" ON "j"."id" = "c"."journey_id" LEFT JOIN "users"');
  });

  it("refuse une condition de jointure qui n'est pas une colonne", () => {
    expect(() => from("journeys").join("users", "u", "u.id", "1 OR 1=1")).toThrow(QueryBuilderError);
  });
});

describe("tri", () => {
  it("trie en ASC par défaut et enchaîne les critères", () => {
    const { text } = from("journeys").orderBy("created_at", "DESC").orderBy("id").toSQL();

    expect(text).toBe('SELECT * FROM "journeys" ORDER BY "created_at" DESC, "id" ASC');
  });

  it("refuse un critère de tri qui n'est pas un nom de colonne", () => {
    expect(() => from("journeys").orderBy("created_at; DROP TABLE users")).toThrow(QueryBuilderError);
  });

  it("refuse un sens de tri hors liste", () => {
    expect(() => from("journeys").orderBy("id", "DESC; --" as Direction)).toThrow(QueryBuilderError);
  });
});

describe("pagination", () => {
  it("lie LIMIT et OFFSET après les valeurs du WHERE", () => {
    const query = from("journeys").where("visibility", "=", "public").orderBy("id").limit(20).offset(40);

    expect(query.toSQL()).toEqual({
      text: 'SELECT * FROM "journeys" WHERE "visibility" = $1 ORDER BY "id" ASC LIMIT $2 OFFSET $3',
      values: ["public", 20, 40],
    });
  });

  it("accepte un OFFSET seul, sans LIMIT", () => {
    expect(from("journeys").offset(10).toSQL()).toEqual({
      text: 'SELECT * FROM "journeys" OFFSET $1',
      values: [10],
    });
  });

  it("accepte un LIMIT seul", () => {
    expect(from("journeys").limit(5).toSQL()).toEqual({
      text: 'SELECT * FROM "journeys" LIMIT $1',
      values: [5],
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuse LIMIT et OFFSET à %s", (count) => {
    expect(() => from("journeys").limit(count)).toThrow(QueryBuilderError);
    expect(() => from("journeys").offset(count)).toThrow(QueryBuilderError);
  });
});

describe("ordre des clauses", () => {
  it("assemble SELECT, FROM, JOIN, WHERE, ORDER BY, LIMIT, OFFSET quel que soit l'ordre d'appel", () => {
    const query = from("journeys", "j")
      .offset(0)
      .limit(10)
      .orderBy("j.created_at", "DESC")
      .where("j.visibility", "=", "public")
      .join("users", "u", "u.id", "j.author_id")
      .select("j.id", "u.display_name");

    expect(query.toSQL()).toEqual({
      text:
        'SELECT "j"."id", "u"."display_name" FROM "journeys" AS "j" ' +
        'INNER JOIN "users" AS "u" ON "u"."id" = "j"."author_id" ' +
        'WHERE "j"."visibility" = $1 ORDER BY "j"."created_at" DESC LIMIT $2 OFFSET $3',
      values: ["public", 10, 0],
    });
  });
});