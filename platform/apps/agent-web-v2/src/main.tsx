import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { App } from "@/app/app";
import "@/styles/globals.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root mount node");
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
