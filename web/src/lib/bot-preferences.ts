import { loadBotFeatured } from "./bot-featured";
import { loadBotSections } from "./bot-sections";

/** Load both independent preferences in parallel with the route's snapshot. */
export async function loadBotPreferences() {
  await Promise.all([loadBotSections(), loadBotFeatured()]);
  return null;
}
