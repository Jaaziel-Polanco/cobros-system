# 🚀 Guía de Despliegue Local — Inversiones Cordero

Este sistema está diseñado para ejecutarse en un **servidor local propio** (Linux, Windows Server o cualquier VPS), sin depender de Vercel ni ningún servicio en la nube externo.

---

## Arquitectura

```
[Servidor Local]
  ├── node server.js          ← Servidor Next.js + Cron scheduler
  ├── /api/cron/recordatorios ← Endpoint del cron (protegido)
  ├── /api/simulate           ← Endpoint de simulación (testing)
  └── Supabase (cloud)        ← Base de datos y autenticación
```

El cron **corre embebido dentro del mismo proceso Node.js** usando `node-cron`. No necesitas crontabs del sistema operativo ni Vercel.

---

## Requisitos del Servidor

- **Node.js** 18+ (recomendado: 20 LTS)
- **npm** 9+
- Acceso a internet para conectar con Supabase
- Puerto 3000 abierto (o el que configures)

---

## Configuración Inicial

### 1. Clonar / copiar el proyecto al servidor

```bash
# Si usas git
git clone <repositorio> /opt/cobros-system
cd /opt/cobros-system

# O copiar la carpeta directamente
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env.local
nano .env.local   # Editar con los valores reales
```

Variables clave:

```env
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
CRON_SECRET=un_secreto_largo_y_aleatorio
CRON_SCHEDULE=0 8,18 * * *    # 8 AM y 6 PM hora RD, todos los días
CRON_RUN_ON_START=true        # Dispara recordatorios reales 2s después de CADA reinicio. Ver sección dedicada más abajo.
PORT=3000
HOSTNAME=0.0.0.0
APP_PUBLIC_URL=https://boletos.tu-dominio.com   # Boletería: base pública de los enlaces y QR de boletos (ver nota abajo)
```

> **Nota:** `.env.example` no está trackeado en git en este repositorio (`.gitignore` excluye
> `.env*`). Esta guía es la referencia versionada de las variables disponibles; si copias
> `.env.example` desde otra máquina o lo reconstruyes, incluye también `APP_PUBLIC_URL` (ver
> arriba).
>
> **`APP_PUBLIC_URL` debe ser una URL alcanzable desde el teléfono del cliente, no una
> dirección de red local.** Desde el Plan 2, cada boleto impreso lleva un código QR
> (`lib/escpos/tirilla-ticket.ts`) que codifica exactamente `${APP_PUBLIC_URL}/t/<token>` —
> el cliente lo escanea con su propio teléfono, fuera de la red de la sucursal, para ver su
> boleto en `app/t/`. Un valor como `http://localhost:3000` o una IP `192.168.x.x` genera un
> QR que solo funciona dentro de la LAN de la sucursal: el cliente lo escanea y su teléfono
> no puede alcanzar esa dirección. Usa un dominio público (o una IP pública) con HTTPS.

#### Generar un CRON_SECRET seguro:

```bash
# En Linux/Mac
openssl rand -base64 32

# En Windows PowerShell
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

### 4. Construir la aplicación

```bash
npm run build
```

### 5. Iniciar el servidor

```bash
# Modo producción (con cron embebido)
npm start
# equivale a: node server.js

# Modo desarrollo (con hot-reload)
npm run start:dev
# equivale a: node server.js --dev
```

Verás en consola:

```
╔══════════════════════════════════════════════════════╗
║  🚀 Inversiones Cordero — Servidor PRODUCCIÓN       ║
╠══════════════════════════════════════════════════════╣
║  🌐 URL: http://localhost:3000
║  📅 Cron: 0 8,18 * * *
║  🔑 CRON_SECRET: ✅ configurado
╚══════════════════════════════════════════════════════╝

[CRON] 📅 Programado: "0 8,18 * * *" (zona horaria: America/Santo_Domingo)
```

---

## Configuración del Horario (CRON_SCHEDULE)

El formato es el estándar de 5 campos: `minuto hora día-mes mes día-semana`

| Expresión         | Significado                                        |
| ----------------- | -------------------------------------------------- |
| `0 8 * * *`       | Todos los días a las 8:00 AM                       |
| `0 8,18 * * *`    | Todos los días a las 8 AM y 6 PM ← **Recomendado** |
| `0 8,12,18 * * *` | 8 AM, 12 PM y 6 PM                                 |
| `0 */4 * * *`     | Cada 4 horas                                       |
| `0 9 * * 1-5`     | Lunes a Viernes a las 9 AM                         |
| `*/30 * * * *`    | Cada 30 minutos (solo para pruebas)                |

👉 Herramienta visual: https://crontab.guru/

---

## Ejecución al iniciar (CRON_RUN_ON_START)

```env
CRON_RUN_ON_START=true   # Default: true si la variable no está presente
```

Al arrancar `server.js`, si `CRON_RUN_ON_START` no está presente o vale
exactamente `"true"`, se dispara una pasada de recordatorios **2 segundos
después** de levantar el servidor, además de quedar programada según
`CRON_SCHEDULE` (cualquier otro valor, incluido `"false"`, la desactiva). Es
útil para
cubrir deudas vencidas mientras el servidor estuvo caído, pero significa que
**cada reinicio del proceso** (deploy, `pm2 restart`, caída y reinicio
automático, `docker restart`) envía recordatorios reales de WhatsApp a los
clientes con deuda vencida en ese momento — no es una ejecución de prueba.

Ponlo en `CRON_RUN_ON_START=false` en cualquier entorno donde los reinicios
sean frecuentes o no controlados (por ejemplo, mientras se depura un
despliegue) para evitar disparos de WhatsApp no planeados.

---

## Disparar el Cron Manualmente

**Desde el navegador:** Ve a `/simulador` → "Disparar Cron ahora"

**Desde terminal:**

```bash
npm run cron:test
```

**Con curl:**

```bash
curl http://localhost:3000/api/cron/recordatorios \
  -H "x-cron-secret: TU_CRON_SECRET"
```

---

## Mantener el Servidor Activo (Producción)

### Opción A: PM2 (Recomendado para Linux)

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar con PM2
pm2 start server.js --name "cobros-system"

# Auto-reiniciar al iniciar el sistema
pm2 startup
pm2 save

# Comandos útiles
pm2 logs cobros-system     # Ver logs en tiempo real
pm2 restart cobros-system  # Reiniciar
pm2 stop cobros-system     # Parar
pm2 status                 # Estado
```

### Opción B: Windows Service (con node-windows)

```bash
npm install -g node-windows
# Seguir guía de node-windows para registrar como servicio Windows
```

### Opción C: Screen / tmux (Linux, simple)

```bash
# Con screen
screen -S cobros
npm start
# Ctrl+A, D para dejar corriendo

# Con tmux
tmux new -s cobros
npm start
# Ctrl+B, D para dejar corriendo
```

---

## Logs del Cron

Cada vez que el cron dispara, verás en consola:

```
[CRON] ⏰ 22/02/2026, 08:00:00 — Iniciando envío de recordatorios...
[CRON] ✅ Completado — Procesadas: 12 | Enviadas: 8 | Omitidas: 4 | Errores: 0
```

También puedes ver el historial completo en la sección **Registros** del dashboard.

---

## Acceso desde la Red Local

Si `HOSTNAME=0.0.0.0`, el sistema es accesible desde cualquier equipo en la misma red:

```
http://IP_DEL_SERVIDOR:3000
```

Para encontrar la IP del servidor:

```bash
# Linux
ip addr show | grep inet

# Windows
ipconfig
```

---

## Impresión en sucursales

### Arquitectura

```
[Servidor Local]                          [PC de sucursal]
  ├── /api/print/hello   ◄──────────────  print-agent (Node.js)
  ├── /api/print/poll    ◄──────────────  ├── consulta trabajos pendientes
  ├── /api/print/ack     ◄──────────────  └── imprime y confirma
  └── purgarPayloadsImpresion (cron)
```

La web **encola** trabajos de impresión (tirilla en ESC/POS, base64) en la
tabla `print_jobs`. El agente instalado en cada PC de sucursal los consulta
por long-poll (`/api/print/poll`), los manda a la impresora física y
confirma el resultado (`/api/print/ack`). El servidor nunca imprime nada
directamente: solo encola y reparte.

### Antes de instalar el agente

Crea las sucursales y estaciones desde `/estaciones` en el sistema. Cada
estación genera un **token** que se muestra una sola vez: es lo que
identifica y autentica a esa PC frente al servidor (viaja en la cabecera
`Authorization: Bearer <token>`, nunca en el cuerpo de la petición).

### Instalación del agente

Documentada en detalle en `print-agent/README.md`: requisitos, tipos de
conexión de impresora (`red` / `windows`), cómo dejarlo corriendo como
servicio de Windows con NSSM, y el simulador para probar sin impresora
física.

`print-agent/` está **excluido de la imagen Docker a propósito**: se
instala en las PC de sucursal, no en el servidor.

### Purga de payloads impresos

Los trabajos de impresión guardan la tirilla completa en base64. Una vez
impresa, ese contenido ya no sirve para nada — el boleto salió del papel —
pero sin purgarlo la tabla crece sin límite. Una tarea programada dentro
del mismo cron embebido de `server.js` vacía periódicamente el
`payload_escpos` de los trabajos terminados, conservando la fila (y su
`preview_texto`) para auditoría.

Variables nuevas (`.env.local`):

```env
PURGA_SCHEDULE=30 3 * * *   # Horario cron (zona RD) de la purga. Default: 3:30 AM.
PURGA_DIAS=7                # Días de retención antes de vaciar el payload. Default: 7.
```

Al arrancar el servidor verás en consola:

```
[PURGA] 🧹 Programada: "30 3 * * *" (retención: 7 días)
```

La purga solo toca trabajos ya resueltos (`impreso` o `error`) y respeta
la ventana de retención: los trabajos en vuelo (`pendiente`, `reclamado`)
nunca se ven afectados.

---

## Troubleshooting

| Problema                     | Solución                                                            |
| ---------------------------- | ------------------------------------------------------------------- |
| `CRON_SECRET no configurado` | Verificar que `.env.local` tiene `CRON_SECRET=...`                  |
| Cron no envía mensajes       | Revisar que hay plantillas activas y webhook activo en el dashboard |
| `Anti-duplicado activo`      | Normal — el sistema espera el intervalo mínimo entre envíos         |
| Puerto 3000 ocupado          | Cambiar `PORT=3001` en `.env.local`                                 |
| Error de Supabase            | Verificar las claves en `.env.local` y la conexión a internet       |
