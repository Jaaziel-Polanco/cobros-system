import { NextResponse } from 'next/server'
import { autenticarEstacion, clienteAdmin } from '@/lib/api-print/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Confirmación del agente. `ok: false` devuelve el trabajo a la cola si le
 * quedan intentos; si no, lo deja en error con el mensaje real de la
 * impresora. Nunca se marca como impreso algo que falló.
 */
export async function POST(req: Request) {
    const cuerpo = await req.json().catch(() => ({}))
    const estacion = await autenticarEstacion(cuerpo?.token)

    if (!estacion) {
        return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
    }

    const jobId = cuerpo?.jobId
    if (typeof jobId !== 'string') {
        return NextResponse.json({ error: 'jobId requerido' }, { status: 400 })
    }

    const supabase = clienteAdmin()

    const { data: job } = await supabase
        .from('print_jobs')
        .select('id, ticket_id, intentos, max_intentos, es_copia')
        .eq('id', jobId)
        .eq('sucursal_id', estacion.sucursal_id)
        .maybeSingle()

    if (!job) {
        return NextResponse.json({ error: 'Trabajo no encontrado' }, { status: 404 })
    }

    if (cuerpo?.ok === true) {
        await supabase
            .from('print_jobs')
            .update({
                estado: 'impreso',
                impreso_at: new Date().toISOString(),
                error_mensaje: null,
            })
            .eq('id', jobId)

        const { data: ticket } = await supabase
            .from('tickets').select('veces_impreso').eq('id', job.ticket_id).single()

        await supabase
            .from('tickets')
            .update({ veces_impreso: (ticket?.veces_impreso ?? 0) + 1 })
            .eq('id', job.ticket_id)

        await supabase.from('ticket_eventos').insert({
            ticket_id: job.ticket_id,
            tipo: 'impreso',
            estado: 'ok',
            es_copia: job.es_copia,
            detalle: `Impreso en ${estacion.nombre} (${estacion.sucursal_nombre})`,
        })

        return NextResponse.json({ estado: 'impreso' })
    }

    const mensaje = typeof cuerpo?.error === 'string'
        ? cuerpo.error.slice(0, 500)
        : 'Error desconocido en la estación'

    const agotado = job.intentos >= job.max_intentos
    const nuevoEstado = agotado ? 'error' : 'pendiente'

    await supabase
        .from('print_jobs')
        .update({
            estado: nuevoEstado,
            error_mensaje: mensaje,
            estacion_id: null,
            claimed_at: null,
        })
        .eq('id', jobId)

    if (agotado) {
        await supabase.from('ticket_eventos').insert({
            ticket_id: job.ticket_id,
            tipo: 'impreso',
            estado: 'error',
            es_copia: job.es_copia,
            detalle: mensaje,
        })
    }

    return NextResponse.json({ estado: nuevoEstado })
}
