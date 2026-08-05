import { cargarConfig, resolverUiPuerto, RUTA_ENV } from './config'
import { configurarLog, log } from './logger'
import { ClienteApi, calcularBackoff, VERSION_AGENTE, type RespuestaHello } from './api'
import { iniciarUi } from './ui-servidor'
import { bucleDeImpresion, dormir } from './bucle'
import { marcarFalloServidor, registrarSaludo } from './estado'

/**
 * El arranque del agente: leer la configuración, saludar al servidor y
 * ceder el control al bucle de impresión (`bucle.ts`).
 *
 * El bucle vive en otro archivo a propósito. Es la parte que no puede
 * equivocarse —cada error suyo es un boleto de más, de menos o duplicado—
 * y aquí dentro, en un `main()` que se ejecuta al importar el archivo, no
 * había manera de escribirle una prueba sin arrancar el agente entero
 * contra un servidor de verdad.
 */
async function main(): Promise<void> {
    const cfg = cargarConfig()
    configurarLog(cfg.logLevel)

    log.info('─'.repeat(52))
    log.info(`Agente de impresión de boletos v${VERSION_AGENTE}`)
    log.info(`Servidor: ${cfg.apiUrl}`)
    log.info(`Modo: ${cfg.pollEsperaMs === 0 ? 'sondeo cada 3 s' : `long-poll ${cfg.pollEsperaMs} ms`}`)
    if (cfg.modoSimulador === 'archivo') {
        log.warn('MODO_SIMULADOR=archivo activo: NO se imprime nada de verdad. Solo para desarrollo.')
    }
    const avisoPuerto = resolverUiPuerto(process.env.UI_PUERTO).aviso
    if (avisoPuerto) log.warn(avisoPuerto)
    log.info('─'.repeat(52))

    /**
     * La interfaz local se levanta ANTES del saludo y sin esperarla.
     *
     * Antes, porque el momento en el que más falta hace el panel de
     * diagnóstico es precisamente cuando el saludo no pasa: servidor caído,
     * token de la otra tienda, `API_URL` mal escrita. Si la interfaz
     * arrancara después del `hello`, con el servidor apagado no habría
     * página que abrir justo cuando hay que averiguar por qué.
     *
     * Y sin esperarla (`void`, no `await`), porque el bucle de impresión no
     * puede depender de que un `listen` salga bien. `iniciarUi` no lanza ni
     * rechaza nunca: si el puerto está ocupado, lo apunta y devuelve `null`.
     */
    void iniciarUi({ cfg, rutaEnv: RUTA_ENV })

    const api = new ClienteApi(cfg.apiUrl, cfg.token, cfg.pollEsperaMs)

    let saludo: RespuestaHello | null = null
    let fallos = 0

    // Presentación inicial, reintentando hasta que el servidor conteste
    for (;;) {
        try {
            saludo = await api.hello()
            registrarSaludo(saludo)
            log.info(`Estación "${saludo.estacion}" · sucursal "${saludo.sucursal}"`)
            const destino = saludo.impresora
            const destinoTexto = destino.tipo_conexion === 'windows'
                ? `Windows: "${destino.nombre}"`
                : `red ${destino.ip}:${destino.port}`
            log.info(`Impresora: ${destinoTexto} · ${saludo.ancho_cols} columnas · ${saludo.codepage}`)
            // La invitación a abrir la interfaz NO se escribe aquí: este bloque
            // no sabe si el `listen` salió bien, y cuando el puerto estaba
            // ocupado el log decía "no se pudo abrir la interfaz" y tres líneas
            // despues mandaba a esa misma direccion — que la sirve OTRO agente.
            // La escribe iniciarUi(), que es quien sí lo sabe.
            break
        } catch (e) {
            fallos++
            const espera = calcularBackoff(fallos)
            marcarFalloServidor((e as Error).message)
            log.error(`No se pudo contactar con el servidor: ${(e as Error).message}`)
            log.info(`Reintentando en ${espera / 1000} s...`)
            await dormir(espera)
        }
    }

    await bucleDeImpresion({ api, cfg, saludo })
}

process.on('SIGINT', () => { log.info('Detenido por el usuario'); process.exit(0) })
process.on('SIGTERM', () => { log.info('Detenido por el sistema'); process.exit(0) })

main().catch(e => {
    log.error(`Error fatal: ${(e as Error).message}`)
    process.exit(1)
})
