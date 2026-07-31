import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Salida de compilación del agente de impresión: es JavaScript generado
    // por tsc a partir de print-agent/src, que sí se analiza. Analizar
    // también el resultado solo produce avisos sobre código que nadie
    // escribe a mano.
    "print-agent/dist/**",
  ]),
  {
    // server.js es el servidor propio con el que arranca la aplicación
    // (package.json -> "start"). Node lo carga como CommonJS, así que sus
    // require() no son un descuido: son la única forma de que funcione.
    files: ["server.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
