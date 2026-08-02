import fs from 'node:fs'
import http from 'node:http'
import { log, configurarLog, RUTA_LOG } from './logger'
import { PAGINA_HTML } from './ui-pagina'
import { VERSION_AGENTE } from './api'
import { ejecutarDiagnostico } from './diagnostico'
import { construirTirillaPrueba } from './prueba-local'
import { imprimir } from './impresora'
import { listarImpresorasWindows } from './impresora-windows'
import { cancelarEnColaWindows, listarColaWindows } from './cola-windows'
import { estadoPausa, pausar, reanudar } from './pausa'
import { LINEAS_POR_DEFECTO, leerFinalDelRegistro, nombreDeDescarga } from './registro'
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
 * ¿La petición la disparó ESTA página, y no otra abierta en el navegador?
 *
 * Hace falta desde que hay rutas GET que lanzan `powershell.exe` (listar
 * impresoras, mirar la cola). Las comprobaciones de más abajo no cubren ese
 * caso: `mutacionPermitida` solo mira los POST, y una página cualquiera de
 * internet puede pedir un GET a este puerto con un `<img src="...">` sin
 * pedir permiso a nadie. No podría LEER la respuesta —de eso se encarga la
 * política de mismo origen del navegador— pero sí podría hacer que la PC de
 * la tienda arranque un proceso de PowerShell por cada imagen, que es
 * justamente lo que no debe poder hacer un desconocido con la caja.
 *
 * `Sec-Fetch-Site` lo manda el propio navegador y una página no puede
 * falsificarlo: dice `cross-site` cuando la petición nace en otro dominio.
 * Cuando no viene (curl, un navegador viejo) no se rechaza: esta cabecera
 * es un cinturón adicional sobre el `Host` y el `listen` en 127.0.0.1, no
 * la única defensa, y bloquear por su ausencia dejaría la página inservible
 * en la PC vieja de una tienda.
 */
export function peticionDeEstaPagina(secFetchSite: string | undefined): boolean {
    if (!secFetchSite) return true
    const valor = secFetchSite.toLowerCase()
    // 'none' es escribir la dirección a mano o un marcador: eso es esta
    // página. 'same-origin' es la propia página pidiendo sus datos.
    return valor === 'same-origin' || valor === 'none'
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
                ? 'La cola de impresión de Windows lo aceptó, que no es lo mismo que «salió papel». '
                  + 'Si no sale, la impresora está apagada, sin papel o en pausa: mira aquí abajo, '
                  + 'en «La cola de Windows», si la hoja se quedó ahí esperando.'
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

// ─── Preguntas a Windows ───────────────────────────────────────

/**
 * Una consulta a PowerShell a la vez por tipo.
 *
 * Cada llamada a PowerShell es un proceso nuevo que tarda medio segundo
 * largo. Un botón se pulsa tres veces cuando parece que no responde, y sin
 * este cerrojo eso son tres `powershell.exe` compitiendo en la PC que tiene
 * que estar imprimiendo. Se rechaza la segunda con un mensaje que dice qué
 * está pasando, en vez de encolarla en silencio.
 */
const enCurso = new Set<string>()

/** Techo global de procesos de PowerShell simultáneos. Ni el botón más
 *  aporreado necesita más de tres, y el bucle de impresión ya está usando
 *  esa misma PC. */
const MAX_CONSULTAS_A_LA_VEZ = 3

async function unaSolaVez<T>(clave: string, tarea: () => Promise<T>): Promise<T> {
    if (enCurso.has(clave) || enCurso.size >= MAX_CONSULTAS_A_LA_VEZ) {
        throw new Error('Ya se le está preguntando eso a Windows. Espera un momento y vuelve a probar.')
    }
    enCurso.add(clave)
    try {
        return await tarea()
    } finally {
        enCurso.delete(clave)
    }
}

/** Un nombre de impresora de Windows no llega ni de lejos a esto. Está para
 *  que nadie pueda meter medio megabyte en una variable de entorno. */
const MAX_LARGO_NOMBRE = 256

/** Envoltorio común: nunca lanza hacia la ruta, devuelve el motivo. */
async function conMotivo<T>(tarea: () => Promise<T>): Promise<{ ok: true; datos: T } | { ok: false; error: string }> {
    try {
        return { ok: true, datos: await tarea() }
    } catch (e) {
        return { ok: false, error: (e as Error).message }
    }
}

async function rutaImpresoras(): Promise<unknown> {
    const r = await conMotivo(() => unaSolaVez('impresoras', () => listarImpresorasWindows()))
    return r.ok ? { impresoras: r.datos, error: null } : { impresoras: null, error: r.error }
}

async function rutaCola(nombre: string | null): Promise<unknown> {
    if (!nombre || nombre.length > MAX_LARGO_NOMBRE) {
        return {
            impresora: null,
            trabajos: null,
            error: 'No se dijo de qué impresora mirar la cola',
        }
    }
    const r = await conMotivo(() => unaSolaVez(`cola:${nombre}`, () => listarColaWindows(nombre)))
    return r.ok
        ? { impresora: nombre, trabajos: r.datos, error: null }
        : { impresora: nombre, trabajos: null, error: r.error }
}

/**
 * Cancelar trabajos de la cola de Windows.
 *
 * Esto tira papel a la basura: un boleto cancelado aquí ya está marcado
 * como impreso en el sistema y nadie lo va a volver a mandar solo. La
 * confirmación la pide la página; aquí lo que se hace es dejarlo escrito en
 * `agente.log` (dentro de `cancelarEnColaWindows`) y no aceptar nada que no
 * venga con la impresora nombrada explícitamente — nada de "cancela lo que
 * haya" sin decir dónde.
 */
async function rutaCancelarCola(cuerpo: unknown): Promise<{ codigo: number; cuerpo: unknown }> {
    const datos = (cuerpo ?? {}) as { impresora?: unknown; id?: unknown; todos?: unknown }
    const nombre = typeof datos.impresora === 'string' ? datos.impresora : ''

    if (!nombre || nombre.length > MAX_LARGO_NOMBRE) {
        return { codigo: 400, cuerpo: { error: 'Falta decir de qué impresora' } }
    }

    let id: number | null = null
    if (datos.todos !== true) {
        if (typeof datos.id !== 'number' || !Number.isInteger(datos.id)) {
            return { codigo: 400, cuerpo: { error: 'Falta el número de trabajo a cancelar' } }
        }
        id = datos.id
    }

    const r = await conMotivo(() => unaSolaVez(`cancelar:${nombre}`, () => cancelarEnColaWindows(nombre, id)))
    if (!r.ok) return { codigo: 200, cuerpo: { ok: false, error: r.error } }

    return { codigo: 200, cuerpo: { ok: true, cancelados: r.datos } }
}

// ─── Pausa ─────────────────────────────────────────────────────

function rutaPausa(cuerpo: unknown, cfg: Config): { codigo: number; cuerpo: unknown } {
    const quiere = (cuerpo as { pausado?: unknown })?.pausado
    if (typeof quiere !== 'boolean') {
        return { codigo: 400, cuerpo: { error: 'Hay que decir si se pausa o se reanuda' } }
    }

    if (quiere) {
        const estado = pausar()
        log.warn(
            'AGENTE EN PAUSA desde la interfaz local. Deja de pedir boletos al servidor: los que '
            + 'se generen se quedan pendientes y salen solos al reanudar. Mientras tanto, en '
            + 'Estaciones esta caja aparece como desconectada. Reanudar en '
            + `http://${DIRECCION_LOCAL}:${cfg.uiPuerto}`,
        )
        return { codigo: 200, cuerpo: { ok: true, pausa: estado } }
    }

    const estabaPausado = estadoPausa().pausado
    const estado = reanudar()
    if (estabaPausado) log.info('Agente reanudado desde la interfaz local: vuelve a pedir boletos.')
    return { codigo: 200, cuerpo: { ok: true, pausa: estado } }
}

// ─── Registro ──────────────────────────────────────────────────

async function rutaRegistro(pedidas: string | null): Promise<unknown> {
    const n = Number(pedidas)
    const lineas = Number.isFinite(n) && n > 0 ? Math.floor(n) : LINEAS_POR_DEFECTO
    const r = await leerFinalDelRegistro(RUTA_LOG, lineas)

    return { ...r, ruta: RUTA_LOG }
}

/**
 * Manda `agente.log` como descarga.
 *
 * Por un flujo y no leyéndolo en memoria: el archivo puede llegar a 5 MB
 * antes de rotar, y este proceso es el que tiene que estar imprimiendo. Si
 * el archivo no existe o se rompe la lectura a mitad, se corta la respuesta
 * sin que nada de eso salga de aquí.
 */
function rutaDescargarRegistro(res: http.ServerResponse): void {
    let flujo: fs.ReadStream
    try {
        flujo = fs.createReadStream(RUTA_LOG)
    } catch (e) {
        responderJson(res, 404, { error: `No se pudo abrir el registro — ${(e as Error).message}` })
        return
    }

    flujo.on('error', e => {
        if (!res.headersSent) {
            responderJson(res, 404, {
                error: `No se pudo leer ${RUTA_LOG} — ${(e as Error).message}`,
            })
            return
        }
        res.destroy()
    })

    flujo.on('open', () => {
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${nombreDeDescarga()}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        })
        flujo.pipe(res)
    })

    // Si el navegador cancela la descarga a medias, se cierra el archivo.
    res.on('close', () => flujo.destroy())
}

function rutaEstado(cfg: Config, rutaEnv: string): unknown {
    const e = instantanea()
    const env = leerEnv(rutaEnv)

    return {
        version: VERSION_AGENTE,
        uiPuerto: cfg.uiPuerto,
        iniciadoEn: e.iniciadoEn,
        // La pausa viaja con el estado, que se refresca cada 3 s, y no solo
        // como respuesta al botón: el cartel tiene que aparecer también en
        // una pestaña que ya estaba abierta cuando otro la pausó, y seguir
        // ahí al recargar la página.
        pausa: estadoPausa(),
        estacion: e.estacion,
        sucursal: e.sucursal,
        destinoTexto: describirDestino(e.destino),
        // Crudos además del texto: la cola de Windows hay que pedirla por el
        // nombre EXACTO de la impresora, y «Windows «POS»» no es ese nombre.
        destinoTipo: e.destino?.tipo_conexion ?? null,
        destinoNombre: e.destino?.nombre ?? null,
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

        if (!peticionDeEstaPagina(req.headers['sec-fetch-site'] as string | undefined)) {
            responderJson(res, 403, { error: 'Esta interfaz solo atiende a su propia página' })
            return
        }

        // La base es fija y de mentira: solo sirve para que `URL` sepa
        // separar la ruta de los parámetros. No se usa para nada más.
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const ruta = url.pathname
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

        if (metodo === 'GET' && ruta === '/api/impresoras') {
            responderJson(res, 200, await rutaImpresoras())
            return
        }

        if (metodo === 'GET' && ruta === '/api/cola') {
            responderJson(res, 200, await rutaCola(url.searchParams.get('impresora')))
            return
        }

        if (metodo === 'GET' && ruta === '/api/registro') {
            responderJson(res, 200, await rutaRegistro(url.searchParams.get('lineas')))
            return
        }

        if (metodo === 'GET' && ruta === '/api/registro/descargar') {
            rutaDescargarRegistro(res)
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
            if (ruta === '/api/pausa') {
                const r = rutaPausa(cuerpo, cfg)
                responderJson(res, r.codigo, r.cuerpo)
                return
            }
            if (ruta === '/api/cola/cancelar') {
                const r = await rutaCancelarCola(cuerpo)
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
