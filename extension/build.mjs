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
    const code = compiled.outputText.replace(
      '"../lib/constants"',
      '"./product.js"',
    );
    await writeFile(path.join(output, filename.replace(/\.ts$/, ".js")), code);
  }
  await writeFile(
    path.join(output, "product.js"),
    `export const APP_NAME = ${JSON.stringify(productName)};\n`,
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
                required: ["authenticationInfo", "browsingActivity"],
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
