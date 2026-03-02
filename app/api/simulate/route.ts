import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { calcularDiasAtraso, getEtapaCobranza } from '@/lib/utils/cobranza-engine'

/**
 * POST /api/simulate
 * Crea un cliente + deuda simulada con fecha_corte configurable
 * para probar el pipeline completo de envíos.
 *
 * Body: { dias_atraso: number, webhook_url?: string }
 */
export async function POST(req: NextRequest) {
    const secret = req.headers.get('x-cron-secret')
    if (secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const diasAtraso: number = body.dias_atraso ?? 10   // default: mora_temprana
    const limpiar: boolean = body.limpiar ?? false

    const supabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Si se pide limpiar, eliminar datos de simulación anteriores
    if (limpiar) {
        await supabase.from('clientes').delete().eq('notas', '__SIMULACION__')
        return NextResponse.json({ ok: true, mensaje: 'Datos de simulación eliminados' })
    }

    // Calcular fecha_corte según días de atraso solicitados
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const fechaCorte = new Date(hoy)
    fechaCorte.setDate(fechaCorte.getDate() - diasAtraso)
    const fechaCorteStr = fechaCorte.toISOString().split('T')[0]

    const etapa = getEtapaCobranza(diasAtraso)

    // Crear cliente simulado
    const { data: cliente, error: clienteError } = await supabase
        .from('clientes')
        .insert({
            nombre: 'DEMO',
            apellido: `Simulación-${diasAtraso}d`,
            telefono: '809-000-0000',
            email: 'demo@simulacion.test',
            dni_ruc: '000-0000000-0',
            activo: true,
            notas: '__SIMULACION__',
        })
        .select()
        .single()

    if (clienteError || !cliente) {
        return NextResponse.json({ error: `Error creando cliente: ${clienteError?.message}` }, { status: 500 })
    }

    // Crear deuda simulada
    const montoOriginal = 50_000
    const saldoPendiente = 35_000
    const diasReal = calcularDiasAtraso(fechaCorteStr)

    const { data: deuda, error: deudaError } = await supabase
        .from('deudas')
        .insert({
            cliente_id: cliente.id,
            descripcion: `Deuda de simulación (${diasAtraso} días de atraso)`,
            monto_original: montoOriginal,
            saldo_pendiente: saldoPendiente,
            tasa_interes: 2.5,
            fecha_corte: fechaCorteStr,
            es_deuda_existente: false,
            estado: 'activo',
            pausado: false,
            etapa,
            dias_atraso: diasReal,
        })
        .select()
        .single()

    if (deudaError || !deuda) {
        // Limpiar cliente si falló la deuda
        await supabase.from('clientes').delete().eq('id', cliente.id)
        return NextResponse.json({ error: `Error creando deuda: ${deudaError?.message}` }, { status: 500 })
    }

    // Crear configuración de recordatorio
    await supabase.from('configuracion_recordatorio').insert({
        deuda_id: deuda.id,
        dias_antes_vencimiento: 3,
        frecuencia_mora_h: 1,          // 1 hora para testing (en prod sería 48h)
        frecuencia_recuperacion_h: 1,  // 1 hora para testing (en prod sería 72h)
    })

    return NextResponse.json({
        ok: true,
        simulacion: {
            cliente_id: cliente.id,
            deuda_id: deuda.id,
            cliente: `${cliente.nombre} ${cliente.apellido}`,
            fecha_corte: fechaCorteStr,
            dias_atraso: diasReal,
            etapa,
            monto_original: montoOriginal,
            saldo_pendiente: saldoPendiente,
            frecuencia_envio_h: 1,
            mensaje: `Cliente simulado creado en etapa "${etapa}" con ${diasReal} días de atraso. El cron enviará en ≤1 hora.`,
        },
    })
}

/**
 * DELETE /api/simulate — limpia todos los datos de simulación
 */
export async function DELETE(req: NextRequest) {
    const secret = req.headers.get('x-cron-secret')
    if (secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Fetch IDs first, then delete
    const { data: toDelete } = await supabase
        .from('clientes')
        .select('id')
        .eq('notas', '__SIMULACION__')

    if (toDelete?.length) {
        await supabase
            .from('clientes')
            .delete()
            .in('id', toDelete.map(r => r.id))
    }

    return NextResponse.json({ ok: true, eliminados: toDelete?.length ?? 0 })
}

