import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { nodesToString } from "react-i18next";

// Static audit only: runtime API/plugin content and computed keys need manual review.
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(project, "src");
const locales = ["en", "de", "nl", "fr", "et", "se", "cz"];
const resources = Object.fromEntries(
  locales.map((locale) => [
    locale,
    Object.fromEntries(
      ["pwa", "plp-pwa"].map((namespace) => [
        namespace,
        {
          ...JSON.parse(
            fs.readFileSync(
              path.join(
                sourceRoot,
                "translation",
                namespace === "pwa" ? "generated-pwa" : "generated",
                `${locale}.json`,
              ),
            ),
          ),
          ...JSON.parse(
            fs.readFileSync(
              path.join(sourceRoot, "translation", `${locale}.json`),
            ),
          ),
        },
      ]),
    ),
  ]),
);
const keys = new Map();
const plainText = [];
const dynamicLookups = [];
const displayProps =
  /^(title|label|labelText|placeholder|helperText|description|alt|aria-label|modalHeading|primaryButtonText|secondaryButtonText|emptyText|text)$/;
const decode = (value) =>
  value.replace(
    /&(#x[\da-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi,
    (_, entity) => {
      if (entity[0] === "#")
        return String.fromCodePoint(
          entity[1].toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1)),
        );
      return {
        amp: "&",
        apos: "'",
        quot: '"',
        lt: "<",
        gt: ">",
        nbsp: "\u00a0",
      }[entity];
    },
  );
const textValue = (value) => decode(value).replace(/\s+/g, " ").trim();
const literal = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
const tag = (node) =>
  ts.isJsxElement(node) ? node.openingElement.tagName.getText() : undefined;
const attribute = (node, name) =>
  node.attributes.properties.find((prop) => prop.name?.getText() === name);
const attributeValue = (node) =>
  !node
    ? undefined
    : ts.isJsxExpression(node.initializer)
    ? literal(node.initializer.expression)
    : literal(node.initializer);
const staticValues = (node) => {
  const value = literal(node);
  if (value !== undefined) return [value];
  if (node && ts.isConditionalExpression(node))
    return [...staticValues(node.whenTrue), ...staticValues(node.whenFalse)];
  return [];
};
// Use TypeScript's JSX whitespace/entity handling and react-i18next's own
// serializer. This inspects syntax only; application expressions are never run.
function richTextKey(node, source) {
  const compiled = ts.transpileModule(node.getText(source), {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ESNext },
  }).outputText;
  const parsed = ts.createSourceFile(
    "trans.js",
    compiled,
    ts.ScriptTarget.Latest,
    true,
  );
  const outer = parsed.statements[0]?.expression;
  if (!outer || !ts.isCallExpression(outer)) return undefined;
  const readChild = (child) => {
    const value = literal(child);
    if (value !== undefined) return value;
    if (ts.isObjectLiteralExpression(child)) {
      const result = {};
      for (const prop of child.properties) {
        if (
          !ts.isPropertyAssignment(prop) &&
          !ts.isShorthandPropertyAssignment(prop)
        )
          throw new Error("computed interpolation");
        if (ts.isComputedPropertyName(prop.name))
          throw new Error("computed interpolation");
        result[literal(prop.name) ?? prop.name.getText(parsed)] =
          literal(prop.initializer) ?? "";
      }
      return result;
    }
    if (
      ts.isCallExpression(child) &&
      child.expression.getText(parsed) === "React.createElement"
    ) {
      const [type, props, ...children] = child.arguments;
      const name =
        literal(type) ?? (ts.isIdentifier(type) ? type.text : undefined);
      if (!name) throw new Error("computed component");
      const attributes =
        props.kind === ts.SyntaxKind.NullKeyword ? null : readChild(props);
      return createElement(name, attributes, ...children.map(readChild));
    }
    throw new Error("runtime child");
  };
  try {
    return nodesToString(outer.arguments.slice(2).map(readChild), {
      transSupportBasicHtmlNodes: true,
      transKeepBasicHtmlNodesFor: ["br", "strong", "i", "p"],
    });
  } catch {
    return undefined;
  }
}

function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const filename = path.join(dir, entry.name);
      return entry.isDirectory()
        ? files(filename)
        : /\.[jt]sx?$/.test(filename) && !/\.test\./.test(filename)
        ? [filename]
        : [];
    });
}
for (const filename of files(sourceRoot)) {
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const location = (node) => ({
    file: path.relative(project, filename),
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
  });
  const record = (key, node, namespace = "pwa") => {
    if (!key) return;
    if (key.includes(":")) {
      const prefix = key.slice(0, key.indexOf(":"));
      if (["pwa", "plp-pwa"].includes(prefix)) {
        namespace = prefix;
        key = key.slice(prefix.length + 1);
      }
    }
    const id = `${namespace}\0${key}`;
    if (!keys.has(id)) keys.set(id, { key, namespace, locations: [] });
    keys.get(id).locations.push(location(node));
  };
  const inspect = (node) => {
    if (
      ts.isCallExpression(node) &&
      /^(t|i18n\.t|i18next\.t)$/.test(node.expression.getText(source))
    ) {
      const values = staticValues(node.arguments[0]);
      const nsOption =
        node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])
          ? node.arguments[1].properties.find(
              (prop) => prop.name?.getText() === "ns",
            )
          : undefined;
      const ns = literal(nsOption?.initializer) || "pwa";
      values.forEach((value) => record(value, node, ns));
      if (!values.length)
        dynamicLookups.push({
          ...location(node),
          expression: node.getText(source),
        });
    }
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText() === "Trans"
    ) {
      const key = attributeValue(attribute(node, "i18nKey"));
      const ns = attributeValue(attribute(node, "ns")) || "pwa";
      if (key) record(key, node, ns);
      else
        dynamicLookups.push({
          ...location(node),
          expression: node.getText(source),
        });
    }
    if (ts.isJsxElement(node) && ["Trans", "HelmetTitle"].includes(tag(node))) {
      const explicit = attributeValue(
        attribute(node.openingElement, "i18nKey"),
      );
      const ns = attributeValue(attribute(node.openingElement, "ns")) || "pwa";
      if (explicit) record(explicit, node, ns);
      else if (node.children.every(ts.isJsxText))
        record(
          textValue(node.children.map((child) => child.text).join("")),
          node,
          ns,
        );
      else {
        const children = node.children.filter(
          (child) => !ts.isJsxText(child) || child.text.trim(),
        );
        const values =
          children.length === 1 && ts.isJsxExpression(children[0])
            ? staticValues(children[0].expression)
            : [];
        values.forEach((value) => record(value, node, ns));
        if (!values.length) {
          const richKey = richTextKey(node, source);
          if (richKey) record(richKey, node, ns);
          else
            dynamicLookups.push({
              ...location(node),
              expression: node.getText(source),
            });
        }
      }
    }
    if (ts.isJsxAttribute(node) && displayProps.test(node.name.getText())) {
      const value = attributeValue(node);
      if (value && /[a-zA-Z]{2}/.test(value)) {
        // This shared wrapper translates its label internally.
        if (
          node.parent.parent.tagName?.getText() === "DebugScreenSwitcher" &&
          node.name.getText() === "label"
        )
          record(value, node);
        else
          plainText.push({ ...location(node), kind: "attribute", text: value });
      }
    }
    if (ts.isJsxText(node) && /[a-zA-Z]{2}/.test(node.text)) {
      let translated = false;
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          ["Trans", "HelmetTitle", "code", "pre", "style", "script"].includes(
            tag(parent),
          )
        )
          translated = true;
      }
      if (!translated)
        plainText.push({
          ...location(node),
          kind: "text",
          text: textValue(node.text),
        });
    }
    // Literal branches rendered directly in JSX (rather than props like className).
    if (
      ts.isJsxExpression(node) &&
      !ts.isJsxAttribute(node.parent) &&
      !ts.isJsxSpreadAttribute(node.parent)
    ) {
      let translated = false;
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (["Trans", "HelmetTitle", "code", "pre"].includes(tag(parent)))
          translated = true;
      }
      if (!translated)
        for (const value of staticValues(node.expression)) {
          if (/[a-zA-Z]{2}/.test(value))
            plainText.push({
              ...location(node),
              kind: "expression",
              text: value,
            });
        }
    }
    // Reviewed static providers for computed translation lookups.
    if (ts.isPropertyAssignment(node) && literal(node.initializer)) {
      const relative = path.relative(sourceRoot, filename);
      const property = node.name.getText().replace(/["']/g, "");
      const providerFields = {
        "components/Epaper/Integrations/ImageEditor/fontStylesList.tsx": [
          "name",
        ],
        "components/Navigation/Navigation.tsx": ["name", "mobileName"],
        "components/BluetoothWifiProvisioning/index.tsx": ["label"],
        "components/SettingsDevices/SettingsDevicesNew.tsx": ["label"],
        "components/Epaper/Integrations/WeatherEditor/WeatherDesign.tsx": [
          "label",
        ],
        "components/Epaper/Integrations/ApothekenNotdienstEditor/ApothekenNotdienstDesign.tsx":
          ["labelKey", "label"],
        "components/Epaper/Integrations/PlaylistEditor/PlaylistSchedule.tsx": [
          "label",
        ],
        "components/Epaper/Settings/DeviceSettings.tsx": ["label"],
      };
      let timingLabel = false;
      if (
        relative === "components/SettingsDevices/Debug/DeviceUploadLogs.tsx"
      ) {
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (
            ts.isVariableDeclaration(parent) &&
            ["timingLabels", "pipelineTimingLabels"].includes(
              parent.name.getText(),
            )
          )
            timingLabel = true;
        }
      }
      if (timingLabel || providerFields[relative]?.includes(property))
        record(node.initializer.text, node);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
}
const entries = [...keys.values()].sort((a, b) => a.key.localeCompare(b.key));
const missing = entries
  .map((entry) => ({
    ...entry,
    locales: locales.filter(
      (locale) => !resources[locale][entry.namespace]?.[entry.key],
    ),
  }))
  .filter((entry) => entry.locales.length);
const report = {
  notes: [
    "Missing means absent or empty in the requested locale/namespace; English fallback may still display readable text.",
    "Plain-text candidates include intentional brands, URLs, sample values and protocol names; review before editing.",
    "Computed keys and strings in runtime data are listed for manual review, not counted as statically verified keys.",
  ],
  summary: {
    staticKeys: entries.length,
    plainTextCandidates: plainText.length,
    dynamicLookups: dynamicLookups.length,
    missingByLocale: Object.fromEntries(
      locales.map((locale) => [
        locale,
        missing.filter((entry) => entry.locales.includes(locale)).length,
      ]),
    ),
  },
  missing,
  plainText,
  dynamicLookups,
};
const output = process.argv.indexOf("--output");
if (output >= 0) {
  if (!process.argv[output + 1])
    throw new Error("--output requires a file path");
  fs.writeFileSync(
    path.resolve(process.argv[output + 1]),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
console.log(JSON.stringify(report.summary, null, 2));
