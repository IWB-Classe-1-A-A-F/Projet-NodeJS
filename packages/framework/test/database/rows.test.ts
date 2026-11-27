import { describe, expect, it } from "vitest";
import { DatabaseError, readRow } from "../../src/index.ts";

describe("readRow", () => {
  const created = new Date("2026-01-01T00:00:00Z");
  const row = readRow({
    title: "Alpes",
    summary: null,
    step_count: "3", // COUNT(*) arrive en texte depuis pg
    position: 2,
    is_public: true,
    created_at: created,
    updated_at: null,
  });

  it("lit chaque type quand la valeur est correcte", () => {
    expect(row.string("title")).toBe("Alpes");
    expect(row.stringOrNull("summary")).toBeNull();
    expect(row.number("step_count")).toBe(3);
    expect(row.number("position")).toBe(2);
    expect(row.boolean("is_public")).toBe(true);
    expect(row.date("created_at")).toBe(created);
    expect(row.dateOrNull("updated_at")).toBeNull();
  });

  it("lit les variantes OrNull quand la valeur est présente", () => {
    const filled = readRow({ summary: "Résumé", updated_at: created });

    expect(filled.stringOrNull("summary")).toBe("Résumé");
    expect(filled.dateOrNull("updated_at")).toBe(created);
  });

  it("refuse un type inattendu en nommant la colonne", () => {
    expect(() => row.string("position")).toThrow('Colonne "position" : texte attendu');
    expect(() => row.boolean("title")).toThrow(DatabaseError);
    expect(() => row.date("title")).toThrow(DatabaseError);
    expect(() => row.string("absente")).toThrow(DatabaseError);
  });

  it.each([["abc"], [""], ["  "], [null], [true]])("refuse %j comme nombre", (value) => {
    expect(() => readRow({ n: value }).number("n")).toThrow(DatabaseError);
  });

  it("refuse un nombre infini", () => {
    expect(() => readRow({ n: Number.POSITIVE_INFINITY }).number("n")).toThrow(DatabaseError);
  });

  it.each([[null], [undefined], ["texte"], [[1, 2]]])("refuse %j comme ligne", (value) => {
    expect(() => readRow(value)).toThrow("Ligne de résultat invalide");
  });
});

describe("DatabaseError", () => {
  it("garde le code et la cause sans les mettre dans le message", () => {
    const cause = new Error("duplicate key value violates unique constraint users_email_key");
    const error = new DatabaseError("La requête a échoué", "23505", { cause });

    expect(error.name).toBe("DatabaseError");
    expect(error.code).toBe("23505");
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain("users_email_key");
  });

  it("accepte l'absence de code", () => {
    expect(new DatabaseError("x").code).toBeUndefined();
  });
});