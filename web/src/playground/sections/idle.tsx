// Idle & resume section of the states playground. Split out of app.tsx; see that file's header
// comment for the whole page's rules.

import { Section, type SectionDef } from "../layout";

export const DEF: SectionDef = {
  id: "idle",
  title: "Idle & resume",
  intent:
    "After 30 minutes without input on a visible page, polling and animations pause. The first input or return to the page refreshes the mounted view in place.",
};

export function IdleSection() {
  return <Section def={DEF}>{null}</Section>;
}
