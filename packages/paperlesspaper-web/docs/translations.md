# Interface translations

The interface uses `react-i18next`, with `pwa` as the default namespace. Bundled translations live in `src/translation`. Local `<locale>.json` files override downloaded files in `generated-pwa` and `generated`. Add or correct translations in the local files so downloading translations does not overwrite fixes.

Use `<Trans>` for rendered text and `t()` from `useTranslation()` for string props, placeholders, accessibility labels and messages. Translate display labels when rendering lists; keep stored values, URLs, product names and protocol identifiers unchanged. Shared wrappers such as `HelmetTitle` and `DebugScreenSwitcher` already translate their text.

For rich text with links, prefer a stable `i18nKey` and named `components`, as in `PRINTER_API_KEY_STORED`. Numeric child indices can change when JSX whitespace is edited. Preserve interpolation names (`{{name}}`) and component tags (`<accountLink>`) in every translation. Use context when the same word has different meanings, such as `Light_font` for a font weight versus `Light` for the interface theme.

## Audit

Run from this package:

```sh
npm run translations:audit -- --output translation-audit.json
```

The command prints coverage counts and optionally writes every missing key, its language/namespace, and source locations to JSON. It checks literal `t()` calls, `<Trans>`, rich text, page titles and reviewed static label providers. It also lists plain-text candidates and unresolved computed lookups for manual review. Add new static label providers to the audit's `providerFields` when introducing another data-driven option list.

A missing entry means no nonempty value exists in that locale and namespace. It does not necessarily mean the user sees a raw key: English fallback may supply readable text. Brands and example URLs in the candidate list generally need no translation. API content, plugin manifests, runtime-generated labels and the linguistic quality of existing translations still require review.

The translation coverage tests guard the audited English, German and Dutch keys, interpolation/component placeholders, and the printer notice's account link. French, Estonian, Swedish and Czech still have missing translations; the audit reports these rather than copying English into those catalogues.
