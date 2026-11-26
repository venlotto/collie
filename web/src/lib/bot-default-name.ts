/** Short names for a bot nobody named. One or two syllables, easy to tell apart in the list. */
export const DEFAULT_BOT_NAMES = [
  "Chispa", "Turbo", "Rayo", "Nube", "Kiwi", "Coco", "Mango", "Pixel", "Bolt", "Faro",
  "Lince", "Cometa", "Brisa", "Trueno", "Nova", "Zafiro", "Ámbar", "Jade", "Quark", "Eco",
  "Lumen", "Cobre", "Pino", "Delta", "Orión", "Volt", "Mika", "Tango", "Yuca", "Ceiba",
] as const;

/**
 * A random name for a bot created without one, avoiding the names already on screen when it can.
 * `pick` is the random source (0 ≤ n < 1), injectable for tests.
 */
export function defaultBotName(taken: Iterable<string> = [], pick: () => number = Math.random): string {
  const used = new Set(Array.from(taken, name => name.trim().toLocaleLowerCase("es")));
  const free = DEFAULT_BOT_NAMES.filter(name => !used.has(name.toLocaleLowerCase("es")));
  const pool = free.length ? free : DEFAULT_BOT_NAMES;
  const base = pool[Math.floor(pick() * pool.length) % pool.length]!;
  if (free.length) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLocaleLowerCase("es"))) return `${base} ${n}`;
}
