import { createServer } from "node:http";
import { createApi, loadConfigFromEnv } from "./createApi";

const config = loadConfigFromEnv();
const handle = createApi(config);
const port = Number(process.env.PORT || 3000);

const server = createServer((req, res) => {
  void handle(req, res).then((ok) => {
    if (!ok) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "not_found" }));
    }
  });
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`ubr-api listening on ${port}\n`);
});
