// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { i18n as I18n } from "i18next";
import { applications } from "../../../helpers/src/epaper/applications";

let i18n: I18n;
beforeAll(async () => {
  vi.stubEnv("MODE", "production");
  localStorage.setItem("i18nextLng", "nl-BE");
  i18n = (await import("../../src/translation/i18n")).default;
});
afterAll(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});

describe("bundled interface translations", () => {
  it("detects regional Dutch and translates the reported labels", () => {
    expect(i18n.resolvedLanguage).toBe("nl");
    expect(i18n.t("Select application")).toBe("Selecteer applicatie");
    expect(i18n.t("Next Image")).toBe("Volgende afbeelding");
    expect(i18n.t("Community Plugins")).toBe("Communityplug-ins");
    expect(i18n.t("Next sync in {{nextSync}}.", { nextSync: "5s" }))
      .toBe("Volgende synchronisatie over 5s.");
  });

  it("provides Dutch names and descriptions for every built-in integration", () => {
    for (const app of applications) {
      for (const key of [app.name, app.description]) {
        expect(i18n.getResource("nl", "pwa", key), key).toBeTruthy();
      }
    }
  });

  it("provides the next image label in every supported language", () => {
    for (const locale of ["en", "de", "nl", "fr", "et", "se", "cz"]) {
      expect(i18n.getResource(locale, "pwa", "Next Image"), locale).toBeTruthy();
    }
  });

  it("uses English for unsupported languages and missing or empty entries", async () => {
    i18n.addResource("en", "pwa", "TEST_FALLBACK", "English fallback");
    i18n.addResource("nl", "pwa", "TEST_FALLBACK", "");
    await i18n.changeLanguage("nl");
    expect(i18n.t("TEST_FALLBACK")).toBe("English fallback");
    await i18n.changeLanguage("es");
    expect(i18n.resolvedLanguage).toBe("en");
    expect(i18n.t("TEST_FALLBACK")).toBe("English fallback");
  });
});
