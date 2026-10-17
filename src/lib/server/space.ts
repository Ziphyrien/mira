import { env } from "cloudflare:workers";

// adapter-cloudflare 8 exposes bindings through `cloudflare:workers` rather than `platform.env`.
export function space(uid: string) {
  return env.SPACE.get(env.SPACE.idFromName(uid));
}

export function directory() {
  return env.DIRECTORY.get(env.DIRECTORY.idFromName("main"));
}

export function adminToken(): string | undefined {
  return env.ADMIN_TOKEN;
}

export function ai() {
  return env.AI;
}
