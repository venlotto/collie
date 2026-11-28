import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { vi } from "vitest";
import { server } from "@/test/msw";
import { fixtureAgents, fixtureWorkspaces } from "@/test/handlers";
import { setLocale, whenLocaleReady } from "@/lib/i18n";
import { wipeDevice } from "@/lib/wipe";
import { MobileAgentHub } from "./mobile-agent-hub";

beforeEach(async () => {
  setLocale("es"); await whenLocaleReady("es");
  server.use(http.get("/api/chat-order", () => HttpResponse.json([])));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(async () => { cleanup(); await wipeDevice("unpair"); });

it("updates list, workspace actions and close controls when the selected language changes", async () => {
  render(<MobileAgentHub panes={fixtureAgents} workspaces={fixtureWorkspaces} writable listScope={{}}
    scopeOf={() => ({})} onChanged={vi.fn()} onOpen={vi.fn()} onPress={vi.fn()} />);
  expect(screen.getByRole("searchbox", { name: "Buscar" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Opciones de webapp" }));
  expect(screen.getByRole("button", { name: "Eliminar workspace" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Cerrar" })).toBeVisible();
  await act(async () => { setLocale("en"); await whenLocaleReady("en"); });
  expect(screen.getByRole("searchbox", { name: "Search" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Delete workspace" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Close" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Eliminar workspace" })).toBeNull();
});
