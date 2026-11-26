// A bot created with the name field left empty gets one of these until its agent names the work
// (the bridge then swaps it, bridge/bot-auto-name.ts). Short, friendly, easy to tell apart.
export const BOT_DEFAULT_NAMES = [
  "Ardilla", "Brújula", "Búho", "Canela", "Chispa", "Coco", "Colibrí", "Cometa", "Faro", "Galleta",
  "Gecko", "Guayaba", "Lince", "Luciérnaga", "Mango", "Mapache", "Nube", "Nutria", "Ola", "Panda",
  "Pingüino", "Pixel", "Pulpo", "Quetzal", "Rayo", "Tucán", "Turrón", "Volcán", "Zorro", "Arepa",
];

export function randomBotName(taken: ReadonlySet<string> = new Set(), random = Math.random): string {
  const free = BOT_DEFAULT_NAMES.filter(name => !taken.has(name));
  const pool = free.length ? free : BOT_DEFAULT_NAMES;
  return pool[Math.floor(random() * pool.length)] ?? "Bot";
}
