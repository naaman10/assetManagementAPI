import type { Services } from "./services.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
};

export type AppEnv = {
  Variables: {
    services: Services;
    user: AuthUser;
  };
};
