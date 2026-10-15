/**
 * Aviso en memoria de «hay trabajos de impresión nuevos».
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────
 *
 * El long-poll de `/api/print/poll` preguntaba a la base cada 1,5 s durante
 * los 25 s de cada petición: ~17 RPC `reclamar_print_jobs` por vuelta y unas
 * 40 llamadas a Supabase por minuto y por agente, día y noche, casi todas
 * para oír «no hay nada».
 *
 * Todo lo que encola o reencola trabajos (imprimir un boleto, la prueba de
 * estación, reencolar, los lotes del sorteo, liberar lo que un agente
 * desconectado dejó reclamado) corre en este mismo proceso de Node. Así que
 * el poll puede dormir hasta que algo de eso avise, con un respaldo cada
 * pocos segundos para lo que no pasa por aquí (la recuperación de trabajos
 * abandonados que hace el propio RPC a los 90 s). Menos llamadas y, de paso,
 * la impresión sale al instante en vez de hasta 1,5 s después.
 *
 * El emisor vive en `globalThis`: las rutas y las server actions de Next se
 * empaquetan por separado y cada paquete tendría su propia copia de un
 * emisor a nivel de módulo, que nunca oiría a los demás.
 */
import { EventEmitter } from 'node:events'

const EVENTO = 'trabajos-nuevos'

const global = globalThis as typeof globalThis & { __cobrosAvisosImpresion?: EventEmitter }

function emisor(): EventEmitter {
    if (!global.__cobrosAvisosImpresion) {
        const e = new EventEmitter()
        // Un oyente por poll abierto; no es una fuga que avisar.
        e.setMaxListeners(0)
        global.__cobrosAvisosImpresion = e
    }
    return global.__cobrosAvisosImpresion
}

/** Despierta a todos los polls en espera. Barato: cada uno hace un RPC. */
export function avisarTrabajosNuevos(): void {
    emisor().emit(EVENTO)
}

/**
 * Resuelve en cuanto se avisa de trabajos nuevos, pasan `ms` o se aborta
 * `signal` (el agente cerró la conexión), lo que ocurra primero.
 */
export function esperarTrabajos(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted || ms <= 0) {
            resolve()
            return
        }
        const e = emisor()
        const terminar = () => {
            clearTimeout(timer)
            e.off(EVENTO, terminar)
            signal.removeEventListener('abort', terminar)
            resolve()
        }
        const timer = setTimeout(terminar, ms)
        e.on(EVENTO, terminar)
        signal.addEventListener('abort', terminar, { once: true })
    })
}

/** Polls esperando ahora mismo. Para pruebas y diagnóstico. */
export function oyentesActivos(): number {
    return emisor().listenerCount(EVENTO)
}
