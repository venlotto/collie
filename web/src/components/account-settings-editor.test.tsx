import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it, vi } from "vitest";
import { server } from "@/test/setup";
import { AccountSettingsEditor } from "./account-settings-editor";

it("changes a selected account's preferences and preserves its other settings", async () => {
  const saved = vi.fn();
  server.use(
    http.get("/api/user-settings/owners", () => HttpResponse.json([
      { sub: "a", username: "Admin" }, { sub: "b", username: "Fixture B" },
    ])),
    http.get("/api/user-settings", () => HttpResponse.json({
      "collie:theme:v1": "dark", "collie:locale:v1": "es", legacyBrowserImported: "1",
    })),
    http.patch("/api/user-settings", async ({ request }) => {
      saved(new URL(request.url).searchParams.get("owner"), await request.json());
      return HttpResponse.json({});
    }),
  );
  render(<AccountSettingsEditor self="a" />);
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: "b" } });
  const field = await screen.findByRole("textbox");
  expect(field).toHaveValue(JSON.stringify({ "collie:theme:v1": "dark", "collie:locale:v1": "es" }, null, 2));
  fireEvent.change(field, { target: { value: JSON.stringify({ "collie:theme:v1": "light", "collie:locale:v1": "es" }) } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith("b", { set: { "collie:theme:v1": "light" }, remove: [] }));
}, 15_000);
