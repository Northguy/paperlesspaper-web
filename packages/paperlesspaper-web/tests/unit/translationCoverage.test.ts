import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInstance } from "i18next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, Trans } from "react-i18next";
import { describe, expect, it } from "vitest";
import enGenerated from "../../src/translation/generated-pwa/en.json";
import en from "../../src/translation/en.json";
import deGenerated from "../../src/translation/generated-pwa/de.json";
import de from "../../src/translation/de.json";
import nlGenerated from "../../src/translation/generated-pwa/nl.json";
import nl from "../../src/translation/nl.json";

const placeholders = (text: string) =>
  [...text.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((match) => match[1]).sort();
const tags = (text: string) =>
  [...text.matchAll(/<\/?[\w-]+>/g)].map((match) => match[0]).sort();

describe("translation coverage", () => {
  it("covers audited static keys in English, German and Dutch", () => {
    const script = fileURLToPath(
      new URL("../../scripts/auditTranslations.mjs", import.meta.url),
    );
    const summary = JSON.parse(
      execFileSync(process.execPath, [script], { encoding: "utf8" }),
    );
    expect(summary.staticKeys).toBeGreaterThan(1000);
    expect(summary.missingByLocale).toMatchObject({ en: 0, de: 0, nl: 0 });
  });

  it("preserves English interpolation names and component tags in Dutch overrides", () => {
    const english = { ...enGenerated, ...en };
    for (const [key, value] of Object.entries(nl)) {
      const source = english[key];
      if (!source) continue;
      expect(placeholders(value), key).toEqual(placeholders(source));
      expect(tags(value), key).toEqual(tags(source));
    }
  });

  it("translates navigation, font labels, diagnostics and interpolated messages", async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: "nl",
      fallbackLng: "en",
      keySeparator: false,
      resources: {
        en: { translation: { ...enGenerated, ...en } },
        de: { translation: { ...deGenerated, ...de } },
        nl: { translation: { ...nlGenerated, ...nl } },
      },
    });
    expect(i18n.t("Back to login")).toBe("Terug naar inloggen");
    expect(i18n.t("Users")).toBe("Gebruikers");
    expect(i18n.t("Extra Bold")).toBe("Extra vet");
    expect(i18n.t("Light", { context: "font" })).toBe("Licht");
    expect(i18n.t("E-paper integration preview")).toBe(
      "Voorbeeld van de e-paperintegratie",
    );
    expect(
      i18n.t("Upload stage {{stage}} ({{status}}):", {
        stage: "render",
        status: "success",
      }),
    ).toBe("Uploadfase render (success):");
    expect(
      i18n.t("Add {{count}} selected pictures to a slideshow.", { count: 3 }),
    ).toBe("Voeg 3 geselecteerde afbeeldingen toe aan een diavoorstelling.");
    const printerNotice = () =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(Trans, {
            i18nKey: "PRINTER_API_KEY_STORED",
            components: {
              accountLink: createElement("a", { href: "/account" }),
            },
          }),
        ),
      );
    expect(printerNotice()).toContain(
      '<a href="/account">accountinstellingen</a>',
    );
    await i18n.changeLanguage("de");
    expect(printerNotice()).toContain(
      '<a href="/account">Kontoeinstellungen</a>',
    );
    expect(i18n.t("Back to login")).toBe("Zurück zur Anmeldung");
    expect(i18n.t("Light", { context: "font" })).toBe("Leicht");
    expect(i18n.t("E-paper integration preview")).toBe(
      "Vorschau der E-Paper-Integration",
    );
  });
});
