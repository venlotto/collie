import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.BOT_TEST_PORT ?? 14785);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "bot-attachments.spec.ts", "bot-activity.spec.ts", "bot-thread.spec.ts", "bot-workspaces.spec.ts", "bot-multiselect.spec.ts",
    "bot-drag.spec.ts", "bot-idle-resume.spec.ts", "bot-remember-sections.spec.ts", "bot-pinned-top.spec.ts", "bot-desk.spec.ts",
    "bot-display-mode.spec.ts", "bot-composer-open.spec.ts", "bot-send-reliability.spec.ts", "bot-questions.spec.ts", "bot-draft-replace.spec.ts", "send-unreadable.spec.ts",
    "bot-keyboard-leak.spec.ts", "bot-probe-draft.spec.ts", "bot-status-reconnect.spec.ts", "bot-startup.spec.ts",
  ],
  workers: 2, timeout: 60_000, use: { baseURL, serviceWorkers: "block" },
  projects: [
    { name: "phone-webkit", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: { command: `bunx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    env: { COLLIE_DEV_TARGET: "http://127.0.0.1:9" }, url: baseURL, reuseExistingServer: false },
});
