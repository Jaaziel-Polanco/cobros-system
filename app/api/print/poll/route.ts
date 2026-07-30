import { NextResponse } from 'next/server'
import { autenticarEstacion, registrarLatido, clienteAdmin } from '@/lib/api-print/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ESPERA_MAX_MS = 25_000
const INTERVALO_MS = 1_500

function dormir(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
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
    const estacion = await autenticarEstacion(cuerpo?.token)

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
        const { data, error } = await supabase.rpc('reclamar_print_jobs', {
            p_estacion_id: estacion.id,
            p_sucursal_id: estacion.sucursal_id,
            p_limite: limite,
        })

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        if (data?.length) {
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

        await dormir(INTERVALO_MS)
    }
}
