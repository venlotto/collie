// Idle & resume section of the states playground. Split out of app.tsx; see that file's header
// comment for the whole page's rules.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useIdleLock } from "@/hooks/use-idle-lock";
import { setLocked, useLocked } from "@/lib/idle";
import { Card, Group, Section, type SectionDef } from "../layout";

export const DEF: SectionDef = {
  id: "idle",
  title: "Idle & resume",
  intent:
    "After 30 minutes without input on a visible page, polling and animations pause. The first input or return to the page refreshes the mounted view in place.",
};

export function IdleSection() {
  const paused = useLocked();
  const [refreshes, setRefreshes] = useState(0);
  const [taps, setTaps] = useState(0);
  useIdleLock(refresh => { if (refresh) setRefreshes(value => value + 1); });
  return <Section def={DEF}>
    <Group title="Resume in place">
      <Card state="idle-resume-in-place" label="The first input refreshes and still reaches its control"
        reach="Leave a visible page untouched for 30 minutes, then tap a control."
        note="Pause sets the real idle store immediately; the real input listener handles the next gesture.">
        <div className="space-y-3 p-4">
          <p>{paused ? "Polling and animations paused" : "Page active"}</p>
          <p>Refreshes: {refreshes} · Taps received: {taps}</p>
          <div className="flex gap-2">
            <Button onClick={() => setLocked(true)}>Pause</Button>
            <Button onClick={() => setTaps(value => value + 1)}>Try the first tap</Button>
          </div>
        </div>
      </Card>
    </Group>
  </Section>;
}
