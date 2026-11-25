import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:14785";
export default defineConfig({
  testDir: "./e2e", testMatch: ["bot-workspaces.spec.ts", "bot-multiselect.spec.ts"],
  workers: 2, timeout: 60_000, use: { baseURL, serviceWorkers: "block" },
  projects: [
    { name: "phone-webkit", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: { command: "bunx vite preview --host 127.0.0.1 --port 14785 --strictPort",
    env: { COLLIE_DEV_TARGET: "http://127.0.0.1:9" }, url: baseURL, reuseExistingServer: false },
});
