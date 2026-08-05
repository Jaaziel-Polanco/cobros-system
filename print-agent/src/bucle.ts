import { log } from './logger'
import { calcularBackoff, ErrorHttp, type ClienteApi, type RespuestaHello } from './api'
import { imprimir } from './impresora'
import { decodificarBase64Estricto } from './base64'
import {
    describirDestino, marcarFalloServidor, marcarLatido, registrarActividad,
    registrarDestino,
} from './estado'
import { estaPausado, estadoPausa, tocaAvisarEnRegistro } from './pausa'
import type { Config } from './config'
import type { DestinoImpresora, TrabajoImpresion } from './tipos'

/**
 * El bucle de impresión: pedir trabajos, imprimirlos, confirmarlos.
 *
 * Vive aparte de `index.ts` (que es solo el arranque: leer la
 * configuración, saludar y levantar la interfaz) por un motivo concreto:
 * poder probarlo. Este bucle es lo único del agente que no puede
 * equivocarse —cada error suyo es un boleto de más, de menos o duplicado—
 * y mientras estuvo dentro de un `main()` que se ejecuta al importar el
 * archivo, no había forma de escribirle una prueba sin arrancar el agente
 * entero contra un servidor de verdad.
 */

/** Piso de espera entre vueltas del bucle, siempre, sin importar el modo. */
export const INTERVALO_MIN_MS = 250

/** Cada cuánto se mira si alguien quitó la pausa. Un segundo es
 *  imperceptible para quien pulsa «Reanudar» y no cuesta nada. */
export const INTERVALO_PAUSA_MS = 1_000

/** Reintentos de `ack(true)` antes de darse por vencido y dejarlo al servidor. */
export const REINTENTOS_ACK_EXITO = 3

/**
 * Lo que se le dice al servidor de un boleto que no se imprimió por la
 * pausa. Acaba en `print_jobs.error_mensaje` y, si el trabajo agotara sus
 * intentos, en el historial del cliente: tiene que explicarse solo.
 */
export const MOTIVO_PAUSA =
    'El agente de esta caja se puso en pausa antes de imprimir este boleto '
    + '(cambio de papel u otra intervención). NO se imprimió nada: el boleto vuelve a la '
    + 'cola y sale solo cuando se reanude el agente.'

export function dormir(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
}

/**
 * Destino de impresión a usar en esta vuelta del bucle.
 *
 * ANTES este agente se quedaba para siempre con el destino que le dio el
 * `hello` de arranque (o, en una versión intermedia, solo refrescaba
 * `ip`/`port` y seguía cacheando `tipo_conexion`/`nombre`). Reproducido en
 * vivo: con el agente corriendo, cambiar la estación de 'red' a 'windows'
 * — o solo el nombre de la impresora Windows — no tenía ningún efecto
 * hasta reiniciar el proceso a mano, y cada trabajo mientras tanto fallaba
 * con un mensaje que contradecía lo que decía la base. Peor aún: los
 * reintentos se consumían en segundos y el trabajo quedaba en 'error'
 * definitivo por una estación mal configurada del lado del agente, no del
 * servidor.
 *
 * La corrección de raíz: el servidor manda el destino COMPLETO en cada
 * respuesta de `poll` (ver app/api/print/poll/route.ts), y aquí se usa
 * ese, sin cachear nada entre vueltas. `saludo.impresora` del `hello`
 * solo sirve como respaldo si alguna vez llega una respuesta de `poll`
 * sin el campo `impresora` (servidor viejo, respuesta corrupta): no debe
 * tumbar el bucle, pero tampoco es el camino normal.
 */
export function resolverDestino(
    saludo: RespuestaHello,
    dePoll: unknown,
): DestinoImpresora {
    if (
        dePoll && typeof dePoll === 'object'
        && (dePoll as { tipo_conexion?: unknown }).tipo_conexion !== undefined
        && (dePoll as { port?: unknown }).port !== undefined
    ) {
        return dePoll as DestinoImpresora
    }
    return saludo.impresora
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
export function jobsValidos(jobs: unknown): TrabajoImpresion[] {
    if (!Array.isArray(jobs)) return []
    return jobs.filter((j): j is TrabajoImpresion =>
        !!j && typeof j === 'object' && typeof (j as { id?: unknown }).id === 'string',
    )
}

/**
 * 401 (token inválido o estación desactivada) no es un fallo transitorio:
 * si el primer intento lo recibe, el segundo y el tercero lo van a
 * recibir también — es la misma credencial rechazada por el mismo motivo,
 * dos segundos después. Antes el agente los trataba igual que un timeout
 * de red: 3 reintentos separados por 1 s, menos de 3 segundos en total, y
 * luego el mismo mensaje ambiguo de "no se pudo confirmar" que un
 * problema de red de verdad. Eso es engañoso dos veces: gasta los
 * reintentos sin ninguna chance de que el resultado cambie, y el mensaje
 * final no dice lo único que de verdad hace falta saber — que hay que ir
 * a revisar el token o el estado de la estación en /estaciones, no
 * esperar a que la red se recupere sola.
 */
export function esFalloDefinitivo(e: unknown): e is ErrorHttp {
    return e instanceof ErrorHttp && e.status === 401
}

/** Lo mínimo del cliente que necesita el bucle. Escrito así para poder
 *  sustituirlo por uno de mentira en las pruebas sin levantar un servidor. */
export type ApiDelBucle = Pick<ClienteApi, 'poll' | 'ack'>

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
export async function confirmarImpreso(
    api: ApiDelBucle,
    jobId: string,
    esperar: (ms: number) => Promise<void> = dormir,
): Promise<void> {
    for (let intento = 1; intento <= REINTENTOS_ACK_EXITO; intento++) {
        try {
            await api.ack(jobId, true)
            log.info(`Trabajo ${jobId} impreso`)
            return
        } catch (e) {
            if (esFalloDefinitivo(e)) {
                log.error(
                    `Trabajo ${jobId} SE IMPRIMIÓ pero el servidor rechazó la confirmación con 401 ` +
                    '(token inválido o estación desactivada). NO es un problema de red: reintentar no ' +
                    'va a cambiar el resultado, así que no se insiste. ACCIÓN REQUERIDA: revisa en ' +
                    '/estaciones que el token de esta estación siga vigente y que la estación esté ' +
                    'activa. Este boleto puede reimprimirse SIN la marca "COPIA" cuando el servidor ' +
                    'recupere el trabajo colgado (pasados 90 s) y alguien vuelva a encolarlo — ' +
                    'verifícalo contra el papel antes de reimprimir.',
                )
                return
            }
            if (intento === REINTENTOS_ACK_EXITO) {
                log.error(
                    `Trabajo ${jobId} SE IMPRIMIÓ pero no se pudo confirmar tras ${REINTENTOS_ACK_EXITO} intentos: ${(e as Error).message}. ` +
                    'No se reporta como fallo (eso reimprimiría el boleto): si la confirmación nunca llega, el servidor recupera el trabajo solo pasados 90 s.',
                )
                return
            }
            await esperar(1_000)
        }
    }
}

export interface OpcionesBucle {
    api: ApiDelBucle
    cfg: Config
    saludo: RespuestaHello
    /** Cuántas vueltas dar. Sin tope en producción; en las pruebas, unas pocas. */
    maxVueltas?: number
    /** Sustituible en las pruebas para no esperar de verdad. */
    esperar?: (ms: number) => Promise<void>
}

/**
 * El bucle. Solo vuelve si se le puso `maxVueltas`; en producción no
 * termina nunca.
 */
export async function bucleDeImpresion(opciones: OpcionesBucle): Promise<void> {
    const { api, cfg, saludo } = opciones
    const esperar = opciones.esperar ?? dormir
    const maxVueltas = opciones.maxVueltas ?? Infinity

    let fallos = 0

    for (let vuelta = 0; vuelta < maxVueltas; vuelta++) {
        /**
         * La pausa se comprueba ANTES del `poll` y esa posición es todo el
         * diseño: no llamar a `poll` significa no reclamar nada, y por
         * tanto que los boletos se queden en `pendiente` en el servidor,
         * con sus intentos intactos, hasta que alguien reanude. Reclamarlos
         * y guardarlos aquí, o reclamarlos y tirarlos, serían dos formas
         * nuevas de perder papel. Ver `pausa.ts`.
         */
        if (estaPausado()) {
            if (tocaAvisarEnRegistro()) {
                const { minutos } = estadoPausa()
                log.warn(
                    `EL AGENTE SIGUE EN PAUSA (${minutos} min). No está pidiendo boletos al `
                    + 'servidor: se acumulan pendientes y salen todos al reanudar desde '
                    + `http://127.0.0.1:${cfg.uiPuerto}. Mientras tanto, en Estaciones esta `
                    + 'caja aparece como desconectada.',
                )
            }
            await esperar(INTERVALO_PAUSA_MS)
            continue
        }

        try {
            const respuesta = await api.poll()
            fallos = 0
            // El servidor contestó: eso es el latido que la interfaz local
            // enseña como "último contacto". Es una asignación en memoria,
            // no retrasa nada.
            marcarLatido()

            const jobs = jobsValidos(respuesta.jobs)
            if (!Array.isArray(respuesta.jobs)) {
                log.warn('La respuesta de poll no trajo un arreglo de trabajos; se ignora esta vuelta')
            }

            const destino = resolverDestino(saludo, respuesta.impresora)
            registrarDestino(destino)
            const textoDestino = describirDestino(destino)

            for (const job of jobs) {
                /**
                 * La pausa también se mira DENTRO del lote, no solo antes
                 * del poll. Un poll trae hasta 5 boletos y se imprimen uno
                 * detrás de otro: sin esto, pulsar «Pausar» mientras sale
                 * el primero mandaría los otros cuatro a una impresora a la
                 * que le están cambiando el rollo. Y esos cuatro son el
                 * peor caso posible: el spooler los acepta, el sistema los
                 * marca impresos y nunca salen.
                 *
                 * Se devuelven con `ack(false)`, que es lo que los deja en
                 * `pendiente` otra vez. No cuesta un intento de más: el
                 * intento ya se gastó al reclamarlos, imprimieran o no.
                 */
                if (estaPausado()) {
                    log.warn(`Trabajo ${job.id} devuelto a la cola: el agente está en pausa`)
                    registrarActividad({
                        id: job.id, at: new Date().toISOString(), tipo: 'boleto',
                        resultado: 'devuelto', detalle: 'Boleto devuelto a la cola por la pausa',
                        destino: textoDestino,
                    })
                    await api.ack(job.id, false, MOTIVO_PAUSA).catch(err =>
                        log.error(`No se pudo devolver el trabajo ${job.id} a la cola: ${(err as Error).message}`),
                    )
                    continue
                }

                const bytes = job.payload_escpos ? decodificarBase64Estricto(job.payload_escpos) : null

                if (!bytes) {
                    const razon = job.payload_escpos
                        ? 'El payload_escpos no es base64 válido'
                        : 'El trabajo llegó sin contenido para imprimir'
                    log.warn(`Trabajo ${job.id}: ${razon}; se descarta`)
                    registrarActividad({
                        id: job.id, at: new Date().toISOString(), tipo: 'boleto',
                        resultado: 'descartado', detalle: 'Boleto sin contenido válido',
                        destino: textoDestino, error: razon,
                    })
                    await api.ack(job.id, false, razon).catch(err =>
                        log.error(`Tampoco se pudo reportar el trabajo ${job.id}: ${(err as Error).message}`),
                    )
                    continue
                }

                log.info(`Imprimiendo ${job.id} (${bytes.length} bytes)${job.es_copia ? ' [copia]' : ''}`)
                const detalle = `Boleto${job.es_copia ? ' (copia)' : ''} · ${bytes.length} bytes`

                try {
                    await imprimir(destino, bytes, cfg.modoSimulador)
                } catch (e) {
                    // Fallo real de impresión: el único caso en el que se
                    // reporta ok:false. El servidor decide si reintenta.
                    const mensaje = (e as Error).message
                    log.error(`Trabajo ${job.id} falló: ${mensaje}`)
                    registrarActividad({
                        id: job.id, at: new Date().toISOString(), tipo: 'boleto',
                        resultado: 'error', detalle, destino: textoDestino, error: mensaje,
                    })
                    await api.ack(job.id, false, mensaje).catch(err =>
                        log.error(`Tampoco se pudo reportar el fallo: ${(err as Error).message}`),
                    )
                    continue
                }

                // 'simulado', no 'impreso': con MODO_SIMULADOR puesto la
                // impresión "sale bien" pero no hay papel. Llamarlo impreso
                // en el panel sería mentir exactamente donde más duele.
                registrarActividad({
                    id: job.id, at: new Date().toISOString(), tipo: 'boleto',
                    resultado: cfg.modoSimulador === 'archivo' ? 'simulado' : 'impreso',
                    detalle, destino: textoDestino,
                })

                // La impresión salió bien. A partir de aquí el único ack
                // posible es de éxito — ver confirmarImpreso().
                await confirmarImpreso(api, job.id, esperar)
            }
        } catch (e) {
            fallos++
            const espera = calcularBackoff(fallos)
            marcarFalloServidor((e as Error).message)
            log.error(`Error consultando trabajos: ${(e as Error).message}`)
            log.debug(`Reintentando en ${espera / 1000} s`)
            await esperar(espera)
            continue
        }

        // Piso de espera: sin esto, un servidor o proxy que responde al
        // instante (sin respetar el long-poll) convierte el bucle en un
        // martilleo de peticiones que satura la PC de la sucursal.
        await esperar(cfg.pollEsperaMs === 0 ? 3_000 : INTERVALO_MIN_MS)
    }
}
