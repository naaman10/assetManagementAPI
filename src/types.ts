import type { Services } from "./services.js";

export type AppEnv = {
  Variables: {
    services: Services;
  };
};
