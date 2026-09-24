import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(
  path.join(directory, "../lib/constants.ts"),
  "utf8",
);
const parsed = ts.createSourceFile(
  "constants.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
let productName;
for (const statement of parsed.statements) {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (
        declaration.name.getText(parsed) === "APP_NAME" &&
        declaration.initializer &&
        ts.isStringLiteral(declaration.initializer)
      )
        productName = declaration.initializer.text;
    }
  }
}
if (!productName)
  throw new Error("APP_NAME must be a string literal in lib/constants.ts.");

// The save body cap is shared with the API (lib/save-body.ts). Each file below
// is transpiled on its own, so a shared value is inlined into product.js
// rather than imported from outside the package.
const saveBody = ts.createSourceFile(
  "save-body.ts",
  await readFile(path.join(directory, "../lib/save-body.ts"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
let saveBodyMaxBytes;
for (const statement of saveBody.statements) {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (
        declaration.name.getText(saveBody) === "SAVE_BODY_MAX_BYTES" &&
        declaration.initializer &&
        ts.isNumericLiteral(declaration.initializer)
      )
        saveBodyMaxBytes = Number(declaration.initializer.text);
    }
  }
}
if (!Number.isSafeInteger(saveBodyMaxBytes))
  throw new Error(
    "SAVE_BODY_MAX_BYTES must be a numeric literal in lib/save-body.ts.",
  );
const manifest = JSON.parse(
  await readFile(path.join(directory, "manifest.json"), "utf8"),
);
const config = await readFile(path.join(directory, "config.ts"), "utf8");
const configFile = ts.createSourceFile(
  "config.ts",
  config,
  ts.ScriptTarget.Latest,
  true,
);
let apiOrigin;
for (const statement of configFile.statements) {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (
        declaration.name.getText(configFile) === "API_ORIGIN" &&
        declaration.initializer &&
        ts.isStringLiteral(declaration.initializer)
      )
        apiOrigin = declaration.initializer.text;
    }
  }
}
if (!apiOrigin || manifest.host_permissions.join() !== `${apiOrigin}/*`)
  throw new Error("The API origin and host permission must match exactly.");

for (const browser of ["chrome", "firefox"]) {
  const output = path.join(directory, "dist", browser);
  await mkdir(path.join(output, "popup"), { recursive: true });
  for (const filename of [
    "background.ts",
    "browser.ts",
    "config.ts",
    "core.ts",
    "popup/options.ts",
  ]) {
    const input = await readFile(path.join(directory, filename), "utf8");
    const compiled = ts.transpileModule(input, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        strict: true,
      },
      fileName: filename,
    });
    const code = compiled.outputText
      .replace('"../lib/constants"', '"./product.js"')
      .replace('"../lib/save-body"', '"./product.js"');
    // Nothing outside dist/<browser> exists once the extension is loaded; an
    // import that escapes it stops the background worker from starting.
    for (const [, specifier] of code.matchAll(/from\s+["'](\.[^"']*)["']/g)) {
      const target = path.resolve(
        path.dirname(path.join(output, filename)),
        specifier,
      );
      if (!target.startsWith(output + path.sep))
        throw new Error(
          `${filename} imports ${specifier}, outside the extension.`,
        );
    }
    await writeFile(path.join(output, filename.replace(/\.ts$/, ".js")), code);
  }
  await writeFile(
    path.join(output, "product.js"),
    `export const APP_NAME = ${JSON.stringify(productName)};\n` +
      `export const SAVE_BODY_MAX_BYTES = ${saveBodyMaxBytes};\n`,
  );
  for (const filename of ["popup/index.html", "popup/options.css"])
    await copyFile(path.join(directory, filename), path.join(output, filename));
  const generated = {
    ...manifest,
    name: productName,
    action: { default_title: `Save to ${productName}` },
    background:
      browser === "chrome"
        ? { service_worker: "background.js", type: "module" }
        : { scripts: ["background.js"], type: "module" },
    ...(browser === "chrome"
      ? { minimum_chrome_version: "121" }
      : {
          browser_specific_settings: {
            gecko: {
              id: "marrow-save@marrow-bice.vercel.app",
              strict_min_version: "140.0",
              data_collection_permissions: {
                // websiteContent: a toolbar save sends the open page (Slice 10).
                required: [
                  "authenticationInfo",
                  "browsingActivity",
                  "websiteContent",
                ],
              },
            },
          },
        }),
  };
  await writeFile(
    path.join(output, "manifest.json"),
    `${JSON.stringify(generated, null, 2)}\n`,
  );
  process.stdout.write(`Built dist/${browser}\n`);
}
