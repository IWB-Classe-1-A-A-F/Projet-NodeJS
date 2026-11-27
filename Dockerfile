FROM node:26.13.1-alpine3.24 AS base
WORKDIR /home/node/app
# node_modules créé ici pour que le volume compose appartienne à l'utilisateur node
RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
USER node

# --- Développement : le code est monté en volume par compose.yaml ---
FROM base AS development
CMD ["sh", "-c", "npm install && npm run dev"]

# --- Build : typecheck + tests + bundle ---
FROM base AS build
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/framework/package.json packages/framework/
COPY --chown=node:node apps/api/package.json apps/api/
RUN npm ci
COPY --chown=node:node . .
RUN npm run typecheck && npm run test && npm run build

# --- Production : uniquement le bundle, ni sources TS ni node_modules ---
FROM node:26.13.1-alpine3.24 AS production
ENV NODE_ENV=production
WORKDIR /home/node/app
COPY --chown=node:node --from=build /home/node/app/apps/api/dist ./dist
# Conteneur non-root
USER node
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? 8000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# node lancé directement (pas via npm) pour recevoir SIGTERM et s'arrêter proprement
CMD ["node", "dist/main.js"]