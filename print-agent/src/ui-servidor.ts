import http from 'node:http'
import { log, configurarLog } from './logger'
import { PAGINA_HTML } from './ui-pagina'
import { VERSION_AGENTE } from './api'
import { ejecutarDiagnostico } from './diagnostico'
import { construirTirillaPrueba } from './prueba-local'
import { imprimir } from './impresora'
import {
    instantanea, describirDestino, destinoConocido, registrarActividad,
} from './estado'
import {
    CLAVES_EDITABLES, aplicarCambiosEnv, enmascararToken, escribirEnv, leerEnv,
    validarCambios, type ClaveEditable,
} from './env-escritor'
import type { Config } from './config'

/**
 * Interfaz local del agente.
 *
 * Tres reglas que no se negocian y que están cableadas en este archivo:
 *
 * 1. **Solo 127.0.0.1.** Nunca 0.0.0.0. Esta página enseña a qué estación
 *    pertenece la PC, deja sustituir el token de la sucursal y disparar
 *    impresiones. La PC de una tienda está en una red compartida con quien
 *    sea: publicarla en la red sería regalar el control de la impresión de
 *    esa sucursal a cualquiera que sepa la IP. Además del `listen` en la
 *    interfaz de bucle, se comprueba la dirección de origen y la cabecera
 *    `Host` de cada petición — lo primero lo garantiza el sistema
 *    operativo, lo segundo tapa el rebinding de DNS, que es la única forma
 *    conocida de que una página de internet hable con un servidor de
 *    localhost.
 *
 * 2. **Cero dependencias.** `node:http` y la página incrustada en un
 *    string. Nada que instalar, nada que descargar, nada que se vea
 *    distinto si la PC está sin internet.
 *
 * 3. **El sondeo manda.** Nada de aquí puede bloquear el bucle de
 *    impresión: no hay E/S síncrona en las rutas salvo la escritura del
 *    `.env` (unos pocos kilobytes, a petición explícita de una persona), y
 *    si el servidor no puede levantarse —el puerto ocupado es el caso
 *    típico— se apunta en el registro y el agente sigue imprimiendo. No hay
 *    ni un `throw` que pueda salir de este módulo.
 */

/** La única dirección en la que se escucha. No es configurable a propósito. */
export const DIRECCION_LOCAL = '127.0.0.1'

const LIMITE_CUERPO_BYTES = 64 * 1024

/** Nombres en llano de cada ajuste, para los avisos de la interfaz. */
const ETIQUETAS: Record<ClaveEditable, string> = {
    API_URL: 'la dirección del servidor',
    ESTACION_TOKEN: 'el token de la estación',
    POLL_ESPERA_MS: 'la espera al preguntar por boletos',
    LOG_LEVEL: 'el detalle del registro',
    MODO_SIMULADOR: 'el modo simulador',
}

/**
 * Ajustes que se aplican en caliente, sin reiniciar.
 *
 * `LOG_LEVEL` porque el registro se consulta a través de una variable de
 * módulo que se puede cambiar en cualquier momento.
 *
 * `MODO_SIMULADOR` porque el bucle lee `cfg.modoSimulador` en cada trabajo,
 * no una sola vez al arrancar. Y sobre todo porque el sentido útil de este
 * cambio es APAGAR el simulador en una tienda donde no está saliendo papel:
 * obligar a reiniciar justo ahí sería obligar a cerrar el servicio de
 * Windows para arreglar un problema que ya está costando boletos.
 *
 * Los otros tres no: `API_URL`, `ESTACION_TOKEN` y `POLL_ESPERA_MS` los
 * congela `ClienteApi` al construirse, y con el token cambia también la
 * identidad de la estación (otra sucursal, otra impresora, otro ancho de
 * papel). Aplicarlos en caliente obligaría a rehacer el saludo y a
 * descartar un sondeo en vuelo en mitad de una impresión: mucho más riesgo
 * para el bucle del que justifica ahorrarse un reinicio. Se guardan, se
 * avisa con claridad de que hace falta reiniciar, y ya.
 */
const EN_CALIENTE: ClaveEditable[] = ['LOG_LEVEL', 'MODO_SIMULADOR']

/** Lo que el agente está usando AHORA, con el mismo formato que el `.env`. */
function valoresEnEjecucion(cfg: Config): Record<ClaveEditable, string> {
    return {
        API_URL: cfg.apiUrl,
        ESTACION_TOKEN: cfg.token,
        LOG_LEVEL: cfg.logLevel,
        POLL_ESPERA_MS: String(cfg.pollEsperaMs),
        MODO_SIMULADOR: cfg.modoSimulador,
    }
}

/** Valor del `.env` normalizado igual que lo normaliza `cargarConfig()`. */
function valorDeDisco(clave: ClaveEditable, env: Record<string, string>, cfg: Config): string {
    const bruto = env[clave]
    if (clave === 'API_URL') return (bruto ?? cfg.apiUrl).replace(/\/$/, '')
    if (clave === 'POLL_ESPERA_MS') return String(Number(bruto ?? 25_000))
    if (clave === 'LOG_LEVEL') return bruto ?? 'info'
    if (clave === 'MODO_SIMULADOR') return (bruto ?? '').trim()
    return bruto ?? ''
}

/**
 * Ajustes que en el `.env` ya dicen una cosa y en el agente valen otra.
 *
 * Cubre tanto lo que se acaba de guardar desde la interfaz como lo que
 * alguien editó a mano en el Bloc de notas y se olvidó de reiniciar — que
 * es el caso silencioso de verdad: el archivo dice lo correcto, la tienda
 * no imprime, y nada en pantalla explica por qué.
 */
export function pendienteDeReinicio(cfg: Config, env: Record<string, string>): string[] {
    const ejecutando = valoresEnEjecucion(cfg)
    return CLAVES_EDITABLES
        .filter(clave => valorDeDisco(clave, env, cfg) !== ejecutando[clave])
        .map(clave => ETIQUETAS[clave])
}

// ─── Comprobaciones de origen ──────────────────────────────────

/** ¿La conexión viene de esta misma máquina? Lo garantiza el `listen`, pero
 *  un cinturón más no cuesta nada y documenta la intención. */
export function esOrigenLocal(direccion: string | undefined): boolean {
    if (!direccion) return false
    return direccion === '127.0.0.1' || direccion === '::1' || direccion === '::ffff:127.0.0.1'
}

/**
 * ¿La cabecera `Host` nombra a localhost?
 *
 * Es la defensa contra el rebinding de DNS: una página cualquiera de
 * internet puede hacer que su dominio resuelva a 127.0.0.1 y pedirle cosas
 * a este servidor desde el navegador de la caja. La conexión llegaría de
 * verdad desde 127.0.0.1 —así que la comprobación de arriba no la
 * detecta—, pero el `Host` seguiría siendo el del dominio del atacante.
 */
export function esHostLocal(host: string | undefined): boolean {
    if (!host) return false
    const soloHost = host.toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
    return soloHost === '127.0.0.1' || soloHost === 'localhost' || soloHost === '::1'
}

/**
 * ¿Se puede aceptar esta petición que CAMBIA algo?
 *
 * Exigir `application/json` no es cosmética: es lo que impide que una
 * página de internet mande un formulario a este puerto sin permiso. Un
 * `<form>` solo puede enviar tres tipos de contenido, y ninguno es JSON, de
 * modo que el navegador se ve obligado a pedir permiso antes (preflight) y
 * aquí nunca se le contesta que sí. El `Origin`, si viene, tiene que ser
 * este mismo servidor.
 */
export function mutacionPermitida(
    contentType: string | undefined,
    origin: string | undefined,
    puerto: number,
): boolean {
    if (!(contentType ?? '').toLowerCase().includes('application/json')) return false
    if (!origin) return true
    const permitidos = [
        `http://127.0.0.1:${puerto}`,
        `http://localhost:${puerto}`,
        `http://[::1]:${puerto}`,
    ]
    return permitidos.includes(origin.toLowerCase())
}

// ─── Utilidades de respuesta ───────────────────────────────────

function responderJson(res: http.ServerResponse, codigo: number, cuerpo: unknown): void {
    const texto = JSON.stringify(cuerpo)
    res.writeHead(codigo, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    })
    res.end(texto)
}

function leerCuerpo(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolver, rechazar) => {
        let bruto = ''
        let bytes = 0
        req.on('data', (trozo: Buffer) => {
            bytes += trozo.length
            if (bytes > LIMITE_CUERPO_BYTES) {
                rechazar(new Error('El cuerpo de la petición es demasiado grande'))
                req.destroy()
                return
            }
            bruto += trozo.toString('utf8')
        })
        req.on('end', () => {
            if (!bruto.trim()) { resolver({}); return }
            try { resolver(JSON.parse(bruto)) } catch { rechazar(new Error('El cuerpo no es JSON válido')) }
        })
        req.on('error', rechazar)
    })
}

// ─── Rutas ─────────────────────────────────────────────────────

/** Solo una prueba a la vez: el botón es tentador y cada clic es papel. */
let pruebaEnCurso = false

/**
 * Contenido de la hoja de prueba.
 *
 * El ancho y el codepage salen de lo que dijo el servidor en el `hello`, no
 * de nada que se pueda escribir aquí: así la línea de acentos se imprime
 * con la misma tabla de caracteres con la que van a salir los boletos. Si
 * el servidor todavía no ha contestado, se usan los valores más comunes
 * (48 columnas, cp850) para que el botón siga sirviendo con el servidor
 * caído, que es justo cuando hace falta.
 */
function datosDeLaPrueba() {
    const e = instantanea()
    return construirTirillaPrueba({
        estacion: e.estacion,
        sucursal: e.sucursal,
        destino: e.destino,
        cols: e.anchoCols ?? 48,
        codepage: e.codepage ?? 'cp850',
    })
}

async function rutaPrueba(cfg: Config): Promise<unknown> {
    const destino = destinoConocido()
    if (!destino) {
        return {
            ok: false,
            destino: 'todavía desconocido',
            error:
                'El agente aún no sabe a qué impresora mandar: el nombre lo decide el servidor, '
                + 'no esta PC. Pulsa «Comprobar de nuevo» arriba; si el servidor contesta, este '
                + 'botón ya funciona.',
        }
    }

    if (pruebaEnCurso) {
        return { ok: false, destino: describirDestino(destino), error: 'Ya hay una prueba imprimiéndose. Espera a que termine.' }
    }

    pruebaEnCurso = true
    const { bytes } = datosDeLaPrueba()
    const textoDestino = describirDestino(destino)
    const id = `prueba-${Date.now()}`

    try {
        await imprimir(destino, bytes, cfg.modoSimulador)

        const simulando = cfg.modoSimulador === 'archivo'
        registrarActividad({
            id, at: new Date().toISOString(), tipo: 'prueba',
            resultado: simulando ? 'simulado' : 'impreso',
            detalle: `Hoja de prueba (${bytes.length} bytes)`,
            destino: textoDestino,
        })
        log.info(`Hoja de prueba mandada a ${textoDestino} desde la interfaz local`)

        const matiz = simulando
            ? 'OJO: el modo simulador está puesto, así que NO ha salido papel. Los bytes se '
              + 'guardaron en la carpeta volcado-simulador. Quita el simulador aquí abajo y vuelve a probar.'
            : destino.tipo_conexion === 'windows'
                ? 'La cola de impresión de Windows lo aceptó. Si no sale papel, la impresora está '
                  + 'apagada, sin papel o en pausa: mira su cola en Impresoras y escáneres.'
                : 'La impresora recibió los bytes. Si no sale papel, revisa que tenga papel y no esté en pausa.'

        return { ok: true, destino: textoDestino, matiz }
    } catch (e) {
        const mensaje = (e as Error).message
        registrarActividad({
            id, at: new Date().toISOString(), tipo: 'prueba', resultado: 'error',
            detalle: `Hoja de prueba (${bytes.length} bytes)`,
            destino: textoDestino, error: mensaje,
        })
        log.error(`La hoja de prueba de la interfaz local falló: ${mensaje}`)
        return { ok: false, destino: textoDestino, error: mensaje }
    } finally {
        pruebaEnCurso = false
    }
}

function rutaEstado(cfg: Config, rutaEnv: string): unknown {
    const e = instantanea()
    const env = leerEnv(rutaEnv)

    return {
        version: VERSION_AGENTE,
        uiPuerto: cfg.uiPuerto,
        iniciadoEn: e.iniciadoEn,
        estacion: e.estacion,
        sucursal: e.sucursal,
        destinoTexto: describirDestino(e.destino),
        anchoCols: e.anchoCols,
        codepage: e.codepage,
        ultimoLatido: e.ultimoLatido,
        ultimoFallo: e.ultimoFallo,
        actividad: e.actividad,
        pendienteReinicio: pendienteDeReinicio(cfg, env),
        // Lo que hay EN EL ARCHIVO: es lo que se está editando en el
        // formulario, y tiene que poder verse aunque no sea lo que el
        // agente esté usando (para eso está `pendienteReinicio`).
        config: {
            API_URL: valorDeDisco('API_URL', env, cfg),
            LOG_LEVEL: valorDeDisco('LOG_LEVEL', env, cfg),
            POLL_ESPERA_MS: valorDeDisco('POLL_ESPERA_MS', env, cfg),
            MODO_SIMULADOR: valorDeDisco('MODO_SIMULADOR', env, cfg),
        },
        // Lo que el agente USA ahora mismo. El aviso de "no está saliendo
        // papel" tiene que mirar esto y no el archivo: si alguien quitó el
        // simulador del `.env` pero no reinició, el papel sigue sin salir.
        enEjecucion: {
            MODO_SIMULADOR: cfg.modoSimulador,
            ESTACION_TOKEN_TAPADO: enmascararToken(cfg.token),
        },
    }
}

function rutaConfig(cuerpo: unknown, cfg: Config, rutaEnv: string): { codigo: number; cuerpo: unknown } {
    if (!cuerpo || typeof cuerpo !== 'object') {
        return { codigo: 400, cuerpo: { error: 'No llegó ningún cambio' } }
    }

    const cambios: Partial<Record<ClaveEditable, string>> = {}
    for (const clave of CLAVES_EDITABLES) {
        const valor = (cuerpo as Record<string, unknown>)[clave]
        if (typeof valor === 'string') cambios[clave] = valor.trim()
    }

    if (Object.keys(cambios).length === 0) {
        return { codigo: 400, cuerpo: { error: 'No llegó ningún cambio' } }
    }

    const errores = validarCambios(cambios)
    if (errores.length) return { codigo: 400, cuerpo: { errores } }

    // API_URL se guarda sin la barra final, igual que la normaliza
    // `cargarConfig()`: si no, el propio agente vería un cambio pendiente
    // de reinicio nada más guardar algo que en realidad no cambió.
    if (cambios.API_URL) cambios.API_URL = cambios.API_URL.replace(/\/$/, '')

    try {
        escribirEnv(rutaEnv, cambios)
    } catch (e) {
        return { codigo: 500, cuerpo: { error: `No se pudo escribir el archivo .env — ${(e as Error).message}` } }
    }

    const ejecutando = valoresEnEjecucion(cfg)
    const cambiadas = (Object.keys(cambios) as ClaveEditable[])
        .filter(clave => cambios[clave] !== ejecutando[clave])

    // En caliente lo que se puede: el bucle lee estos dos en cada vuelta.
    if (cambios.LOG_LEVEL !== undefined) {
        cfg.logLevel = cambios.LOG_LEVEL
        configurarLog(cambios.LOG_LEVEL)
    }
    if (cambios.MODO_SIMULADOR !== undefined) {
        cfg.modoSimulador = cambios.MODO_SIMULADOR as '' | 'archivo'
    }

    const necesitanReinicio = cambiadas
        .filter(clave => !EN_CALIENTE.includes(clave))
        .map(clave => ETIQUETAS[clave])

    // Se apunta QUÉ cambió, nunca a qué valor: el token no puede acabar en
    // `agente.log` por ninguna vía (ver `sanear` en api.ts).
    if (cambiadas.length) {
        log.info(`Configuración cambiada desde la interfaz local: ${cambiadas.join(', ')}`)
        if (cambios.MODO_SIMULADOR === 'archivo') {
            log.warn('MODO_SIMULADOR=archivo activado desde la interfaz local: a partir de ahora NO se imprime nada de verdad.')
        }
    }

    return { codigo: 200, cuerpo: { ok: true, necesitanReinicio } }
}

// ─── Servidor ──────────────────────────────────────────────────

export interface OpcionesUi {
    cfg: Config
    rutaEnv: string
}

function crearManejador({ cfg, rutaEnv }: OpcionesUi) {
    return async function manejar(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (!esOrigenLocal(req.socket.remoteAddress) || !esHostLocal(req.headers.host)) {
            responderJson(res, 403, { error: 'Esta interfaz solo se atiende desde la propia PC' })
            return
        }

        const ruta = (req.url ?? '/').split('?')[0]
        const metodo = req.method ?? 'GET'

        if (metodo === 'GET' && (ruta === '/' || ruta === '/index.html')) {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
                'Referrer-Policy': 'no-referrer',
                // Todo va incrustado en la propia página: esta política deja
                // fuera cualquier carga externa, que es también la garantía
                // de que la interfaz se ve igual sin internet.
                'Content-Security-Policy':
                    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                    + "connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
            })
            res.end(PAGINA_HTML)
            return
        }

        if (metodo === 'GET' && ruta === '/api/estado') {
            responderJson(res, 200, rutaEstado(cfg, rutaEnv))
            return
        }

        if (metodo === 'GET' && ruta === '/api/prueba-vista') {
            responderJson(res, 200, { vistaPrevia: datosDeLaPrueba().vistaPrevia })
            return
        }

        if (metodo === 'POST') {
            if (!mutacionPermitida(req.headers['content-type'], req.headers.origin, cfg.uiPuerto)) {
                responderJson(res, 403, { error: 'Petición rechazada por seguridad' })
                return
            }

            let cuerpo: unknown
            try {
                cuerpo = await leerCuerpo(req)
            } catch (e) {
                responderJson(res, 400, { error: (e as Error).message })
                return
            }

            if (ruta === '/api/diagnostico') {
                responderJson(res, 200, await ejecutarDiagnostico(cfg))
                return
            }
            if (ruta === '/api/prueba') {
                responderJson(res, 200, await rutaPrueba(cfg))
                return
            }
            if (ruta === '/api/config') {
                const r = rutaConfig(cuerpo, cfg, rutaEnv)
                responderJson(res, r.codigo, r.cuerpo)
                return
            }
        }

        responderJson(res, 404, { error: 'No hay nada en esa dirección' })
    }
}

/**
 * Levanta la interfaz local. **Nunca lanza y nunca rechaza.**
 *
 * Si el puerto está ocupado (dos agentes en la misma PC, otra cosa
 * escuchando en el 9110), se apunta en el registro y se devuelve `null`: el
 * agente tiene que seguir imprimiendo. Quedarse sin panel de diagnóstico es
 * un incordio; quedarse sin imprimir es una tienda que no puede cobrar.
 */
export function iniciarUi(opciones: OpcionesUi): Promise<http.Server | null> {
    const { cfg } = opciones

    if (cfg.uiPuerto === 0) {
        log.info('Interfaz local desactivada (UI_PUERTO=0).')
        return Promise.resolve(null)
    }

    return new Promise(resolver => {
        let resuelto = false
        const terminar = (servidor: http.Server | null) => {
            if (resuelto) return
            resuelto = true
            resolver(servidor)
        }

        try {
            const manejar = crearManejador(opciones)
            const servidor = http.createServer((req, res) => {
                manejar(req, res).catch(e => {
                    log.warn(`La interfaz local falló atendiendo ${req.url}: ${(e as Error).message}`)
                    try { responderJson(res, 500, { error: (e as Error).message }) } catch { /* ya respondida */ }
                })
            })

            servidor.on('error', (e: NodeJS.ErrnoException) => {
                const motivo = e.code === 'EADDRINUSE'
                    ? `el puerto ${cfg.uiPuerto} ya lo está usando otro programa (¿hay otro agente abierto?)`
                    : e.message
                log.warn(
                    `No se pudo abrir la interfaz local: ${motivo}. El agente sigue imprimiendo con normalidad; `
                    + 'cambia UI_PUERTO en el .env si quieres el panel, o ponlo en 0 para no volver a intentarlo.',
                )
                terminar(null)
            })

            // La dirección va fija a 127.0.0.1: es lo que impide que esta
            // página se vea desde cualquier otra PC de la red de la tienda.
            servidor.listen(cfg.uiPuerto, DIRECCION_LOCAL, () => {
                log.info(`Interfaz local en http://${DIRECCION_LOCAL}:${cfg.uiPuerto} (solo desde esta PC)`)
                terminar(servidor)
            })
        } catch (e) {
            log.warn(`No se pudo abrir la interfaz local: ${(e as Error).message}. El agente sigue imprimiendo.`)
            terminar(null)
        }
    })
}

/** Reexportado para las pruebas del escritor de `.env`. */
export { aplicarCambiosEnv }
