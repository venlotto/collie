import { loadBotFeatured } from "./bot-featured";
import { loadBotDisplays } from "./bot-display";
import { loadBotSections } from "./bot-sections";

/** Load all independent preferences in parallel with the route's snapshot. */
export async function loadBotPreferences() {
  await Promise.all([loadBotSections(), loadBotFeatured(), loadBotDisplays()]);
  return null;
}
