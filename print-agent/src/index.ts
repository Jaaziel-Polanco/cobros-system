import { cargarConfig } from './config'
import { configurarLog, log } from './logger'
import { ClienteApi, calcularBackoff, VERSION_AGENTE, type RespuestaHello } from './api'
import { imprimir } from './impresora'
import type { DestinoImpresora } from './tipos'

function dormir(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
}

/**
 * `poll` puede traer un `{ ip, port }` más reciente que el del `hello`
 * (una estación de red puede cambiar de IP sin reiniciar el agente). Pero
 * solo trae eso: `tipo_conexion` y `impresora_nombre` los fija el `hello`
 * para toda la sesión, así que aquí se completa lo que falte en vez de
 * reemplazar el destino entero — si se sustituyera sin más, una estación
 * `windows` perdería su nombre en cuanto `poll` devolviera algo.
 */
function resolverDestino(
    saludo: RespuestaHello,
    dePoll: { ip: string; port: number } | undefined,
): DestinoImpresora {
    if (!dePoll || saludo.impresora.tipo_conexion !== 'red') return saludo.impresora
    return { ...saludo.impresora, ip: dePoll.ip, port: dePoll.port }
}

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
    log.info('─'.repeat(52))

    const api = new ClienteApi(cfg.apiUrl, cfg.token, cfg.pollEsperaMs)

    let saludo: RespuestaHello | null = null
    let fallos = 0

    // Presentación inicial, reintentando hasta que el servidor conteste
    for (;;) {
        try {
            saludo = await api.hello()
            log.info(`Estación "${saludo.estacion}" · sucursal "${saludo.sucursal}"`)
            const destino = saludo.impresora
            const destinoTexto = destino.tipo_conexion === 'windows'
                ? `Windows: "${destino.nombre}"`
                : `red ${destino.ip}:${destino.port}`
            log.info(`Impresora: ${destinoTexto} · ${saludo.ancho_cols} columnas · ${saludo.codepage}`)
            break
        } catch (e) {
            fallos++
            const espera = calcularBackoff(fallos)
            log.error(`No se pudo contactar con el servidor: ${(e as Error).message}`)
            log.info(`Reintentando en ${espera / 1000} s...`)
            await dormir(espera)
        }
    }

    fallos = 0

    for (;;) {
        try {
            const { jobs, impresora } = await api.poll()
            fallos = 0

            const destino = resolverDestino(saludo!, impresora)

            for (const job of jobs) {
                if (!job.payload_escpos) {
                    log.warn(`Trabajo ${job.id} sin contenido; se descarta`)
                    await api.ack(job.id, false, 'El trabajo llegó sin contenido para imprimir')
                    continue
                }

                const bytes = Buffer.from(job.payload_escpos, 'base64')
                log.info(`Imprimiendo ${job.id} (${bytes.length} bytes)${job.es_copia ? ' [copia]' : ''}`)

                try {
                    await imprimir(destino, bytes, cfg.modoSimulador)
                    await api.ack(job.id, true)
                    log.info(`Trabajo ${job.id} impreso`)
                } catch (e) {
                    const mensaje = (e as Error).message
                    log.error(`Trabajo ${job.id} falló: ${mensaje}`)
                    // Se reporta el fallo real. El servidor decide si reintenta.
                    // Este es exactamente el punto que el servicio de
                    // referencia no cubría: aquí SIEMPRE llega ok:false si
                    // `imprimir` rechazó, nunca se confunde con un éxito.
                    await api.ack(job.id, false, mensaje).catch(err =>
                        log.error(`Tampoco se pudo reportar el fallo: ${(err as Error).message}`),
                    )
                }
            }

            if (cfg.pollEsperaMs === 0) await dormir(3_000)
        } catch (e) {
            fallos++
            const espera = calcularBackoff(fallos)
            log.error(`Error consultando trabajos: ${(e as Error).message}`)
            log.debug(`Reintentando en ${espera / 1000} s`)
            await dormir(espera)
        }
    }
}

process.on('SIGINT', () => { log.info('Detenido por el usuario'); process.exit(0) })
process.on('SIGTERM', () => { log.info('Detenido por el sistema'); process.exit(0) })

main().catch(e => {
    log.error(`Error fatal: ${(e as Error).message}`)
    process.exit(1)
})
