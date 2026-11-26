// The router and its stores start reading as soon as their modules evaluate.
import { prepareAccount, showAccountError } from "./lib/koperca-account";

async function boot() {
  try {
    await prepareAccount();
  } catch {
    showAccountError();
    return;
  }
  await import("./main");
}

void boot();
