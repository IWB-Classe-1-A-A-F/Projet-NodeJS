# Projet-NodeJS — Carnet de voyage partagé

Monorepo npm :

- `packages/framework` — le framework HTTP, sans aucun code métier
- `apps/api` — l'application métier, écrite uniquement avec le framework

L'application importe `@projet/framework`, qui pointe directement sur `packages/framework/src` :
toute modification du framework est visible tout de suite, sans publication.

## Ce qui a été mis en place (étape 0)

- **Monorepo npm** avec workspaces : le framework et l'application sont deux paquets liés localement.
- **TypeScript strict** : un seul `tsconfig.json` pour tout le projet, vérifié par `tsc --noEmit`, séparément du build.
- **Tests vitest** avec un seuil de couverture à 100 % : `npm test` échoue si du code du framework n'est pas testé.
- **Build rolldown** : toute l'application (framework et dépendances compris) est regroupée dans `apps/api/dist/main.js`.
- **Développement avec tsx** : l'application redémarre à chaque modification.
- **Docker** : un Dockerfile en trois étapes (développement, build, production) et un `compose.yaml` de développement avec PostgreSQL.
- **Premier élément du framework** : `HttpError`, qui produit le format d'erreur unique de l'API, avec ses tests.
- **Secrets** : uniquement dans `.env`, exclu de Git ; `.env.example` liste les variables à remplir.

## Démarrer

```bash
cp .env.example .env      # puis remplir POSTGRES_PASSWORD, DATABASE_URL et JWT_SECRET
npm install
npm run dev               # tsx watch : relance à chaque modification
```

Ou avec Docker : `docker compose up -d` (API + PostgreSQL), puis http://localhost:8000/health.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | lance l'API en développement avec tsx |
| `npm run typecheck` | vérification des types, sans émission (`tsc --noEmit`) |
| `npm test` | tests vitest du framework ; échoue si la couverture passe sous 100 % |
| `npm run build` | bundle rolldown dans `apps/api/dist/main.js` |
| `npm run check` | typecheck, puis tests, puis build : la même vérification que la CI |

## Dépendances installées


```bash
# Outils de développement, à la racine (partagés par tout le monorepo)
npm install -D typescript @types/node rolldown tsx vitest

# Dépendances de production de l'application
npm install -w @projet/api pg bcryptjs jsonwebtoken

# Types de l'application (dev)
npm install -D -w @projet/api @types/pg @types/jsonwebtoken

# Lien entre l'application et le framework (workspace local, rien n'est téléchargé)
npm install -w @projet/api @projet/framework
```

Pour un membre qui clone le dépôt, une seule commande suffit : `npm install`.