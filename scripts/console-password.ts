import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// Sets the console password (DESIGN §14). Generates a random password unless
// one is passed, writes only its scrypt hash (CONSOLE_PASSWORD_HASH) and a
// session secret to .env, and writes the plain password to
// .console-password.txt (gitignored) so it never appears in a terminal log.
// Read it, store it in your password manager, then delete the file.
// Usage: npm run console:password [-- "your own passphrase"]

// Colons, not dollar signs: Next expands $NAME inside .env values.
function hash(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  return `scrypt:${salt}:${scryptSync(password, salt, 32).toString("base64url")}`;
}

const given = process.argv[2];
const password = given && given.length >= 12 ? given : randomBytes(18).toString("base64url");
if (given && given.length < 12) console.log("That passphrase is shorter than 12 characters, so a random one was generated instead.");

let env = readFileSync(".env", "utf8");
const set = (name: string, value: string) => {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^\\s*${name}=.*$`, "m");
  // A function replacement, so nothing in the value is read as a $ pattern.
  env = pattern.test(env) ? env.replace(pattern, () => line) : `${env}${env.endsWith("\n") ? "" : "\n"}${line}\n`;
};
set("CONSOLE_PASSWORD_HASH", hash(password));
if (!/^\s*CONSOLE_SESSION_SECRET=\S/m.test(env)) set("CONSOLE_SESSION_SECRET", randomBytes(32).toString("base64url"));
writeFileSync(".env", env);
writeFileSync(".console-password.txt", `${password}\n`, { mode: 0o600 });
console.log("Wrote CONSOLE_PASSWORD_HASH and CONSOLE_SESSION_SECRET to .env, and the password to .console-password.txt.");
console.log("Copy both variables to Vercel. Keep the password somewhere safe and delete .console-password.txt.");
