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
 *   PURGA_SCHEDULE      → Expresión cron de la purga de payloads impresos
 *                         (default: "30 3 * * *")
 *   PURGA_DIAS          → Días de retención antes de vaciar el payload
 *                         (default: 7)
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

// OPT-IN, no opt-out. El default era "true", así que CADA arranque del proceso
// —deploy, `docker restart`, un crash con reinicio automático— mandaba una
// tanda real de WhatsApps a la hora que fuera.
//
// No producía duplicados prohibidos (el intervalo por etapa se respetaba: 0
// violaciones en 20 días de envios_log), sino algo más difícil de ver:
// ADELANTABA a la hora del deploy los envíos que tocaban en la próxima corrida
// programada. Medido en producción el 2026-07-30: un reinicio a las 21:28
// disparó 155 mensajes de cobro a las 9 de la noche, y la corrida de las 8:00
// del día siguiente bajó de 336 envíos a 6 — se los había comido el deploy.
// En 30 días fueron 258 envíos fuera de horario en 10 ráfagas.
//
// El caso que esto cubría (servidor caído durante un horario programado) lo
// resuelve la siguiente corrida a las pocas horas, o el disparo manual desde
// /simulador. No justifica que un deploy pueda escribirle a un cliente a
// cualquier hora.
const CRON_RUN_ON_START = process.env.CRON_RUN_ON_START === "true";

const app = next({ dev: isDev, hostname: HOSTNAME, port: PORT });
const handle = app.getRequestHandler();

let cronTask = null;
let purgaTask = null;
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

const PURGA_SCHEDULE = process.env.PURGA_SCHEDULE ?? "30 3 * * *";

// parseInt de un valor no numérico da NaN. NaN se serializa como `null` en
// JSON.stringify, y el RPC purgar_payloads_impresos(p_dias) recibe un NULL
// explícito — que en PL/pgSQL NO dispara el DEFAULT 7 del parámetro (eso
// solo pasa cuando el argumento se omite del todo). El resultado era una
// purga que corre sin ningún error, filtra por
// "COALESCE(impreso_at, created_at) < NOW() - (NULL || ' days')::INTERVAL"
// — que también da NULL — y por tanto no purga NUNCA una sola fila, en
// silencio. Con respaldo explícito a 7 si el valor no es un entero positivo.
const PURGA_DIAS_RAW = parseInt(process.env.PURGA_DIAS ?? "7", 10);
const PURGA_DIAS =
  Number.isFinite(PURGA_DIAS_RAW) && PURGA_DIAS_RAW > 0 ? PURGA_DIAS_RAW : 7;
if (process.env.PURGA_DIAS !== undefined && PURGA_DIAS_RAW !== PURGA_DIAS) {
  console.error(
    `[PURGA] ⚠️ PURGA_DIAS="${process.env.PURGA_DIAS}" no es un entero positivo válido. Usando ${PURGA_DIAS} por defecto.`,
  );
}

/**
 * Vacía el contenido ESC/POS de los trabajos de impresión ya terminados.
 * Las filas se conservan para auditoría; solo se libera el base64, que es
 * lo único que ocupa espacio de verdad.
 */
async function purgarPayloadsImpresion() {
  if (isShuttingDown) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("[PURGA] ❌ Faltan credenciales de Supabase. Omitida.");
    return;
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/purgar_payloads_impresos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ p_dias: PURGA_DIAS }),
    });

    if (!res.ok) {
      console.error(`[PURGA] ⚠️ Respuesta ${res.status}: ${await res.text()}`);
      return;
    }

    console.log(`[PURGA] ✅ ${await res.text()} payloads liberados`);
  } catch (err) {
    console.error(`[PURGA] ❌ Error: ${err.message}`);
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

  if (purgaTask) {
    purgaTask.stop();
    console.log("[PURGA] Tarea programada detenida.");
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

    // Mismo criterio que CRON_SCHEDULE arriba: una expresión inválida se
    // reporta fuerte y claro, en vez de desactivar la purga en silencio
    // (que era el comportamiento anterior — sin el `else`, un typo en
    // PURGA_SCHEDULE dejaba la base creciendo para siempre sin ningún
    // aviso en el log).
    if (cron.validate(PURGA_SCHEDULE)) {
      purgaTask = cron.schedule(PURGA_SCHEDULE, purgarPayloadsImpresion, {
        timezone: "America/Santo_Domingo",
      });
      console.log(
        `[PURGA] 🧹 Programada: "${PURGA_SCHEDULE}" (retención: ${PURGA_DIAS} días)`,
      );
    } else {
      console.error(
        `[PURGA] ❌ Expresión inválida: "${PURGA_SCHEDULE}". Purga deshabilitada.`,
      );
    }

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
