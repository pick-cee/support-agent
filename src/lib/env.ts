import "server-only";

/**
 * Reads a server secret or setting. A missing value is an explicit failure,
 * never a plausible default: a route that silently ran without its token
 * would accept anyone.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** The app's own origin, without a trailing slash. */
export function appBaseUrl(): string {
  return requireEnv("APP_BASE_URL").replace(/\/+$/, "");
}
