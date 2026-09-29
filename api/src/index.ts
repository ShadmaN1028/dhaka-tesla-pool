import { app } from "./app";
import { env } from "./env";
import { logger } from "./logger";

app.listen(env.API_PORT, (err?: Error) => {
  if (err) {
    logger.fatal({ err }, `Could not listen on :${env.API_PORT}`);
    process.exit(1);
  }
  logger.info(`API listening on :${env.API_PORT}`);
});
