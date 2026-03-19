/**
 * server.js — Servidor Next.js personalizado con cron embebido
 *
 * Reemplaza `next start` para entornos auto-hospedados (sin Vercel).
 * Incluye un scheduler node-cron que llama al endpoint de recordatorios
 * en el horario configurado en CRON_SCHEDULE (formato cron estándar).
 *
 * Uso:
 *   node server.js          → producción
 *   node server.js --dev    → desarrollo (usa next dev internamente)
 *
 * Variables de entorno requeridas (.env.local):
 *   CRON_SECRET         → Secreto para autenticar el endpoint del cron
 *   CRON_SCHEDULE       → Expresión cron (default: "0 8,18 * * *")
 *   PORT                → Puerto del servidor (default: 3000)
 *   HOSTNAME            → Hostname (default: 0.0.0.0 para acceso en red)
 */

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const cron = require("node-cron");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env.local") });

const isDev =
  process.argv.includes("--dev") || process.env.NODE_ENV === "development";
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOSTNAME = process.env.HOSTNAME ?? "0.0.0.0";

const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? "0 8,18 * * *";
const CRON_SECRET = process.env.CRON_SECRET;
const CRON_RUN_ON_START = (process.env.CRON_RUN_ON_START ?? "true") === "true";

const app = next({ dev: isDev, hostname: HOSTNAME, port: PORT });
const handle = app.getRequestHandler();

let cronTask = null;
let isShuttingDown = false;

async function dispararRecordatorios() {
  if (isShuttingDown) return;

  const url = `http://localhost:${PORT}/api/cron/recordatorios`;
  const timestamp = new Date().toLocaleString("es-DO", {
    timeZone: "America/Santo_Domingo",
    hour12: false,
  });

  console.log(`\n[CRON] ⏰ ${timestamp} — Iniciando envío de recordatorios...`);

  if (!CRON_SECRET) {
    console.error("[CRON] ❌ CRON_SECRET no configurado. Abortando.");
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    const res = await fetch(url, {
      method: "GET",
      headers: { "x-cron-secret": CRON_SECRET },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();

    if (data.ok) {
      console.log(
        `[CRON] ✅ Completado — Total: ${data.total_deudas} | Procesadas: ${data.procesadas} | Enviadas: ${data.enviados} | Omitidas: ${data.omitidos} | Errores: ${data.errores}`,
      );
    } else {
      console.error(`[CRON] ⚠️  Respuesta con error: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[CRON] ❌ Timeout: el endpoint no respondió en 2 minutos");
    } else {
      console.error(`[CRON] ❌ Error de red al llamar endpoint: ${err.message}`);
    }
  }
}

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[SERVER] ${signal} recibido. Cerrando servidor...`);

  if (cronTask) {
    cronTask.stop();
    console.log("[CRON] Tarea programada detenida.");
  }

  server.close(() => {
    console.log("[SERVER] Servidor HTTP cerrado.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("[SERVER] Forzando cierre después de 10s.");
    process.exit(1);
  }, 10_000);
}

let server;

app.prepare().then(() => {
  server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  server.listen(PORT, HOSTNAME, () => {
    const mode = isDev ? "DESARROLLO" : "PRODUCCIÓN";
    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log(`║  🚀 Inversiones Cordero — Servidor ${mode}       ║`);
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log(
      `║  🌐 URL: http://${HOSTNAME === "0.0.0.0" ? "localhost" : HOSTNAME}:${PORT}`,
    );
    console.log(`║  📅 Cron: ${CRON_SCHEDULE}`);
    console.log(
      `║  🔑 CRON_SECRET: ${CRON_SECRET ? "✅ configurado" : "❌ NO configurado"}`,
    );
    console.log("╚══════════════════════════════════════════════════════╝\n");

    if (!cron.validate(CRON_SCHEDULE)) {
      console.error(
        `[CRON] ❌ Expresión inválida: "${CRON_SCHEDULE}". Cron desabilitado.`,
      );
      return;
    }

    cronTask = cron.schedule(CRON_SCHEDULE, dispararRecordatorios, {
      timezone: "America/Santo_Domingo",
    });

    console.log(
      `[CRON] 📅 Programado: "${CRON_SCHEDULE}" (zona horaria: America/Santo_Domingo)`,
    );
    console.log(
      `[CRON] ⚙️ Ejecución automática al iniciar: ${CRON_RUN_ON_START ? "activada" : "desactivada"}`,
    );
    console.log(
      '[CRON] 💡 Para probar ahora: ve a /simulador y usa "Disparar Cron ahora"\n',
    );

    // Ejecuta una pasada al iniciar para cubrir deudas existentes
    // sin esperar al próximo horario del cron.
    if (CRON_RUN_ON_START) {
      setTimeout(() => {
        dispararRecordatorios().catch((err) => {
          console.error("[CRON] ❌ Error en ejecución inicial:", err?.message ?? err);
        });
      }, 2000);
    }
  });

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
});
