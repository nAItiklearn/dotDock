import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../design-system/tokens.css";
import { PRODUCT_NAME } from "../lib/branding";
import { setNativeApi } from "../lib/native/api";
import { initApp } from "../lib/state/app";
import { applyCurrentAppearance } from "../lib/theme/useAppearance";
import { widgetCatalog } from "../overlay/catalog";
import { connectProviders } from "../providers/bridge";
import { SettingsApp } from "./SettingsApp";

const params = new URLSearchParams(location.search);
document.title = `${PRODUCT_NAME} Settings`;

const root = document.getElementById("root");
if (!root) throw new Error("settings.html is missing #root");

async function start(): Promise<void> {
  // `?native=mock` previews the desktop-only pages against sample data. The branch is removed from production builds.
  if (import.meta.env.DEV && params.get("native") === "mock") {
    const { createMockNativeApi } = await import("../lib/native/mock");
    setNativeApi(createMockNativeApi());
  }
  const app = initApp({ catalog: widgetCatalog });
  await Promise.all([document.fonts.ready, app.start()]);
  applyCurrentAppearance();
  createRoot(root!).render(
    <StrictMode>
      <SettingsApp />
    </StrictMode>,
  );
  // Widget previews show live data, so the same providers the desktop uses feed this window too.
  connectProviders().catch((err: unknown) => console.error("providers failed to connect", err));
}

void start();
