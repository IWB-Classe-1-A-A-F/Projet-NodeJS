
import http from "node:http";
import { HttpError, type ErrorBody } from "@projet/framework";

const port = Number(process.env["PORT"] ?? "8000");
const host = process.env["HOST"] ?? "0.0.0.0";

const send = (response: http.ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, { status: "ok" });
    return;
  }
  const notFound: ErrorBody = new HttpError(404, "NOT_FOUND", "Route introuvable").toBody();
  send(response, 404, notFound);
});

server.listen(port, host, () => {
  console.log(`API à l'écoute sur http://${host}:${port}`);
});


const shutdown = (signal: string): void => {
  console.log(`${signal} reçu, arrêt en cours...`);
  server.close(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
