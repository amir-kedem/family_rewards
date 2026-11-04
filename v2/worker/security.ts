export const encoder = new TextEncoder();
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterations, salt, expected] = encoded.split("$");
  const rounds = Number(iterations);
  if (
    algorithm !== "pbkdf2" ||
    !Number.isInteger(rounds) ||
    rounds < 100000 ||
    rounds > 1000000 ||
    !salt ||
    !/^[a-f0-9]{64}$/.test(expected || "")
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: rounds,
      salt: encoder.encode(salt),
    },
    key,
    256,
  );
  const actual = Array.from(new Uint8Array(bits), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
  let diff = 0;
  for (let i = 0; i < actual.length; i++)
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
export function cutoff(now = new Date()) {
  const d = new Date(now),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 6);
  d.setUTCDate(
    Math.min(
      day,
      new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  return d.toISOString();
}
