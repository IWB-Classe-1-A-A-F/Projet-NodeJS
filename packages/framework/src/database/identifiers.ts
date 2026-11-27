/** Erreur levée quand une requête est mal construite. Le Query Builder ne connaît pas HTTP. */
export class QueryBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryBuilderError";
  }
}

// Un identifiant (table, colonne, alias) : lettres, chiffres, underscore, ne commence pas par un chiffre.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Un nom de table ou de colonne ne peut pas être un paramètre lié en SQL.
 * On le valide strictement puis on l'entoure de guillemets doubles (syntaxe PostgreSQL).
 * Accepte "colonne" ou "table.colonne".
 */
export const quoteIdentifier = (name: string): string => {
  const parts = name.split(".");
  if (parts.length > 2) {
    throw new QueryBuilderError(`Identifiant invalide : "${name}" (au plus un point)`);
  }
  return parts
    .map((part) => {
      if (!IDENTIFIER.test(part)) {
        throw new QueryBuilderError(`Identifiant invalide : "${name}"`);
      }
      return `"${part}"`;
    })
    .join(".");
};