import type { Services } from "./services.js";

export type AuthRole = {
  id: string;
  name: string;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  roles: AuthRole[];
  permissions: string[];
};

export type AppEnv = {
  Variables: {
    services: Services;
    user: AuthUser;
  };
};
