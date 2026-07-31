import { NextResponse } from 'next/server'
import { autenticarEstacion, extraerToken, registrarLatido, clienteAdmin } from '@/lib/api-print/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ESPERA_MAX_MS = 25_000
const INTERVALO_MS = 1_500

/** Espera `ms`, pero se corta antes si `signal` se aborta (cliente desconectado). */
function dormir(ms: number, signal: AbortSignal) {
    return new Promise<void>(resolve => {
        if (signal.aborted) {
            resolve()
            return
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        function onAbort() {
            clearTimeout(timer)
            resolve()
        }
        signal.addEventListener('abort', onAbort, { once: true })
    })
}

/**
 * Entrega trabajos de impresión al agente local.
 *
 * Mantiene la petición abierta hasta 25 s esperando trabajos (long-poll), lo
 * que hace la impresión casi instantánea sin websockets. Si el agente envía
 * `espera: 0`, responde de inmediato: es la vía de escape si algún proxy
 * inverso corta las conexiones largas.
 */
export async function POST(req: Request) {
    const cuerpo = await req.json().catch(() => ({}))
    const estacion = await autenticarEstacion(extraerToken(req))

    if (!estacion) {
        return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
    }

    const limite = Math.min(Math.max(Number(cuerpo?.max) || 5, 1), 20)
    const esperaMax = cuerpo?.espera === 0 ? 0 : ESPERA_MAX_MS
    const supabase = clienteAdmin()
    const inicio = Date.now()

    await registrarLatido(
        estacion.id,
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        typeof cuerpo?.version === 'string' ? cuerpo.version : null,
    )

    for (;;) {
        // El agente se reinició, perdió la red o cerró la conexión: seguir
        // sondeando hasta los 25 s no sirve a nadie y solo retrasa la
        // liberación de lo que ya se hubiera reclamado. Cortamos aquí antes
        // de gastar otra vuelta de RPC.
        if (req.signal.aborted) {
            return new Response(null, { status: 204 })
        }

        const { data, error } = await supabase.rpc('reclamar_print_jobs', {
            p_estacion_id: estacion.id,
            p_sucursal_id: estacion.sucursal_id,
            p_limite: limite,
        })

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        if (data?.length) {
            if (req.signal.aborted) {
                /**
                 * El agente se desconectó en la ventana entre pedir el RPC y
                 * recibir la respuesta: los trabajos ya quedaron marcados
                 * 'reclamado' en la base, pero esta respuesta no va a llegar
                 * a nadie que la lea. Sin esto quedarían huérfanos hasta que
                 * reclamar_print_jobs los recupere pasados 90 s (ver la
                 * migración de la cola). Los liberamos ahora mismo para que
                 * el próximo poll —de este agente al reconectar, o de otra
                 * estación— los reciba de inmediato en vez de esperar la
                 * recuperación por timeout.
                 */
                await supabase
                    .from('print_jobs')
                    .update({ estado: 'pendiente', estacion_id: null, claimed_at: null })
                    .in('id', data.map((j: { id: string }) => j.id))
                    .eq('estado', 'reclamado')
                return new Response(null, { status: 204 })
            }

            return NextResponse.json({
                jobs: data.map((j: {
                    id: string; payload_escpos: string | null; es_copia: boolean
                }) => ({
                    id: j.id,
                    payload_escpos: j.payload_escpos,
                    es_copia: j.es_copia,
                })),
                impresora: { ip: estacion.impresora_ip, port: estacion.impresora_port },
            })
        }

        if (Date.now() - inicio >= esperaMax) {
            return NextResponse.json({ jobs: [] })
        }

        await dormir(INTERVALO_MS, req.signal)
    }
}
