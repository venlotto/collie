import { defineConfig, devices } from "@playwright/test";
import bots from "./playwright.bots.config";

const liveURL = process.env.RESPONSIVE_LIVE_URL;

export default defineConfig({
  ...bots,
  testMatch: "bot-responsive.spec.ts",
  workers: 1,
  use: { ...bots.use, baseURL: liveURL ?? bots.use?.baseURL },
  webServer: liveURL ? undefined : bots.webServer,
  timeout: 60_000,
  projects: [
    { name: "phone-375", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } } },
    { name: "phone-webkit", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "desktop-1920", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
  ],
});
