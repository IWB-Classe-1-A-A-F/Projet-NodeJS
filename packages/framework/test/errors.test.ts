import { describe, expect, it } from "vitest";
import { HttpError, isHttpError } from "../src/index.ts";

describe("HttpError", () => {
  it("produit le format d'erreur unique sans détails", () => {
    const error = new HttpError(404, "NOT_FOUND", "Ressource introuvable");

    expect(error.status).toBe(404);
    expect(error.name).toBe("HttpError");
    expect(error.toBody()).toEqual({
      error: { code: "NOT_FOUND", message: "Ressource introuvable" },
    });
  });

  it("inclut les détails quand ils sont fournis", () => {
    const details = [{ field: "email", message: "requis" }];
    const error = new HttpError(422, "VALIDATION_FAILED", "Données invalides", details);

    expect(error.toBody()).toEqual({
      error: { code: "VALIDATION_FAILED", message: "Données invalides", details },
    });
  });

  it("isHttpError distingue une HttpError d'une autre valeur", () => {
    expect(isHttpError(new HttpError(400, "BAD_REQUEST", "x"))).toBe(true);
    expect(isHttpError(new Error("x"))).toBe(false);
    expect(isHttpError("x")).toBe(false);
  });
});
