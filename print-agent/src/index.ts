import { cargarConfig } from './config'
import { configurarLog, log } from './logger'
import { ClienteApi, calcularBackoff, VERSION_AGENTE, type RespuestaHello } from './api'
import { imprimir } from './impresora'
import { decodificarBase64Estricto } from './base64'
import type { DestinoImpresora, TrabajoImpresion } from './tipos'

/** Piso de espera entre vueltas del bucle, siempre, sin importar el modo. */
const INTERVALO_MIN_MS = 250

/** Reintentos de `ack(true)` antes de darse por vencido y dejarlo al servidor. */
const REINTENTOS_ACK_EXITO = 3

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

/**
 * El servidor debería mandar siempre un arreglo en `jobs`, pero el agente
 * no puede asumirlo: una respuesta inesperada (un cambio de contrato, un
 * proxy que reescribe el cuerpo, un bug del servidor) no puede tumbar el
 * bucle ni, peor, iterarse como si fuera válida. `for...of` sobre una
 * cadena la recorre carácter por carácter sin lanzar ningún error — así
 * es como una respuesta con `jobs: "algo"` termina mandando decenas de
 * miles de `ack` con un id vacío en segundos.
 */
function jobsValidos(jobs: unknown): TrabajoImpresion[] {
    if (!Array.isArray(jobs)) return []
    return jobs.filter((j): j is TrabajoImpresion =>
        !!j && typeof j === 'object' && typeof (j as { id?: unknown }).id === 'string',
    )
}

/**
 * Confirma una impresión que sí tuvo éxito.
 *
 * Aquí solo cabe reportar éxito: si el `ack` falla por red, NO se convierte
 * en un `ack(false)` — eso es justo lo que hacía que un fallo de red
 * después de imprimir bien reimprimiera el boleto (el trabajo volvía a
 * 'pendiente' y el siguiente poll lo entregaba de nuevo). Se reintenta un
 * par de veces por si el fallo fue pasajero; si de verdad no hay forma de
 * confirmar, se deja así: pasados 90 s el servidor recupera el trabajo
 * colgado por su cuenta (ver `reclamar_print_jobs`), que reimprime como
 * mucho una vez — mejor que reimprimir en cada fallo de red.
 */
async function confirmarImpreso(api: ClienteApi, jobId: string): Promise<void> {
    for (let intento = 1; intento <= REINTENTOS_ACK_EXITO; intento++) {
        try {
            await api.ack(jobId, true)
            log.info(`Trabajo ${jobId} impreso`)
            return
        } catch (e) {
            if (intento === REINTENTOS_ACK_EXITO) {
                log.error(
                    `Trabajo ${jobId} SE IMPRIMIÓ pero no se pudo confirmar tras ${REINTENTOS_ACK_EXITO} intentos: ${(e as Error).message}. ` +
                    'No se reporta como fallo (eso reimprimiría el boleto): si la confirmación nunca llega, el servidor recupera el trabajo solo pasados 90 s.',
                )
                return
            }
            await dormir(1_000)
        }
    }
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
            const respuesta = await api.poll()
            fallos = 0

            const jobs = jobsValidos(respuesta.jobs)
            if (!Array.isArray(respuesta.jobs)) {
                log.warn('La respuesta de poll no trajo un arreglo de trabajos; se ignora esta vuelta')
            }

            const destino = resolverDestino(saludo!, respuesta.impresora)

            for (const job of jobs) {
                const bytes = job.payload_escpos ? decodificarBase64Estricto(job.payload_escpos) : null

                if (!bytes) {
                    const razon = job.payload_escpos
                        ? 'El payload_escpos no es base64 válido'
                        : 'El trabajo llegó sin contenido para imprimir'
                    log.warn(`Trabajo ${job.id}: ${razon}; se descarta`)
                    await api.ack(job.id, false, razon).catch(err =>
                        log.error(`Tampoco se pudo reportar el trabajo ${job.id}: ${(err as Error).message}`),
                    )
                    continue
                }

                log.info(`Imprimiendo ${job.id} (${bytes.length} bytes)${job.es_copia ? ' [copia]' : ''}`)

                try {
                    await imprimir(destino, bytes, cfg.modoSimulador)
                } catch (e) {
                    // Fallo real de impresión: el único caso en el que se
                    // reporta ok:false. El servidor decide si reintenta.
                    const mensaje = (e as Error).message
                    log.error(`Trabajo ${job.id} falló: ${mensaje}`)
                    await api.ack(job.id, false, mensaje).catch(err =>
                        log.error(`Tampoco se pudo reportar el fallo: ${(err as Error).message}`),
                    )
                    continue
                }

                // La impresión salió bien. A partir de aquí el único ack
                // posible es de éxito — ver confirmarImpreso().
                await confirmarImpreso(api, job.id)
            }
        } catch (e) {
            fallos++
            const espera = calcularBackoff(fallos)
            log.error(`Error consultando trabajos: ${(e as Error).message}`)
            log.debug(`Reintentando en ${espera / 1000} s`)
            await dormir(espera)
            continue
        }

        // Piso de espera: sin esto, un servidor o proxy que responde al
        // instante (sin respetar el long-poll) convierte el bucle en un
        // martilleo de peticiones que satura la PC de la sucursal.
        await dormir(cfg.pollEsperaMs === 0 ? 3_000 : INTERVALO_MIN_MS)
    }
}

process.on('SIGINT', () => { log.info('Detenido por el usuario'); process.exit(0) })
process.on('SIGTERM', () => { log.info('Detenido por el sistema'); process.exit(0) })

main().catch(e => {
    log.error(`Error fatal: ${(e as Error).message}`)
    process.exit(1)
})
