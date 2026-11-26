import { RouterProvider } from "react-router";

import { router } from "./router";
import { BusyBar } from "@/components/busy-bar";
import { ThemeTrialRibbon } from "@/components/theme-trial-ribbon";
import { UpdateScreen } from "@/components/update-screen";
import { UpdateScreenProvider, useUpdateScreenValue } from "@/components/update-screen-provider";
import { useLocked } from "@/lib/idle";

// THE PROVIDER IS OUTERMOST, and it has to be: the reading is owned out here, beside the sheet,
// and it is also needed INSIDE the router, where the band lives. One hook call, handed to both.
// See `components/update-screen-provider.tsx` for why the badge moved into the band at all.
export function App() {
  return (
    <UpdateScreenProvider>
      <AppShell />
    </UpdateScreenProvider>
  );
}

function AppShell() {
  const paused = useLocked();
  const screen = useUpdateScreenValue();
  // BusyBar overlays every route (fixed, top of viewport) — a mutation anywhere shows the strip.
  return (
    <>
      {/* Idle stops animations and leaves every control reachable. The update screen alone
          owns a blocking dialog and makes its background inert. */}
      <div style={{ display: "contents" }} inert={screen.blocking} data-app-covered={paused || screen.blocking ? "" : undefined}>
        <BusyBar />
        <RouterProvider router={router} />
      </div>
      <UpdateScreen screen={screen} />
      {/* A theme being tried (M59 spec 08): outside the inert wrapper and over everything, so the way
          back stands whatever covers the app and whatever the theme does to it. */}
      <ThemeTrialRibbon />
    </>
  );
}
