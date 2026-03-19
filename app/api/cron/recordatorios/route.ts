import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { renderTemplate, formatMonto, formatFecha } from '@/lib/utils/template-renderer'
import { debeEnviar, getIntervaloEnvio, debeEnviarPreventivo } from '@/lib/utils/cobranza-engine'
import { WebhookPayload, EtapaCobranza, FrecuenciaPago } from '@/lib/types'
import { verificarCronSecret } from '@/lib/utils/auth'

const BATCH_SIZE = 25
const WEBHOOK_TIMEOUT_MS = 15_000

async function fetchConTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
    try {
        return await fetch(url, { ...init, signal: controller.signal })
    } finally {
        clearTimeout(timer)
    }
}

async function procesarEnvio(
    supabase: ReturnType<typeof createAdminClient>,
    webhook: { url: string; headers: Record<string, string> },
    payload: WebhookPayload,
    logData: Record<string, unknown>
) {
    let estadoEnvio: 'enviado' | 'error' = 'enviado'
    let respuestaHttp: number | undefined
    let respuestaBody: string | undefined

    try {
        const resp = await fetchConTimeout(webhook.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...webhook.headers },
            body: JSON.stringify(payload),
        })
        respuestaHttp = resp.status
        respuestaBody = await resp.text()
        if (!resp.ok) { estadoEnvio = 'error' }
    } catch (e) {
        estadoEnvio = 'error'
        respuestaBody = e instanceof DOMException && e.name === 'AbortError'
            ? `Timeout: webhook no respondió en ${WEBHOOK_TIMEOUT_MS}ms`
            : String(e)
    }

    const { error: logError } = await supabase.from('envios_log').insert({
        ...logData,
        estado: estadoEnvio,
        respuesta_http: respuestaHttp,
        respuesta_body: respuestaBody,
    })

    if (logError) {
        console.error('[CRON] Error al insertar log de envío:', logError.message)
    }

    return { estado: estadoEnvio }
}

export async function GET(req: NextRequest) {
    if (!verificarCronSecret(req.headers.get('x-cron-secret'))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    try {
        // 1. Actualizar dias_atraso y etapa atómicamente en la DB (fuente de verdad)
        await supabase.rpc('actualizar_dias_atraso')

        // 2. Obtener deudas activas — limitar envios_log a los últimos 5 por deuda
        const { data: deudas, error: deudasError } = await supabase
            .from('deudas')
            .select(`
                *,
                cliente:clientes(*),
                agente:profiles(id, full_name),
                configuracion:configuracion_recordatorio(*)
            `)
            .eq('estado', 'activo')
            .eq('pausado', false)
            .neq('etapa', 'saldado')

        if (deudasError) throw deudasError

        // Cargar últimos envíos por deuda (solo los recientes, no todo el historial)
        const deudaIds = deudas?.map(d => d.id) ?? []
        let enviosPorDeuda = new Map<string, Array<{ sent_at: string; tipo_destino: string; referencia_id: string | null }>>()

        if (deudaIds.length > 0) {
            const { data: enviosRecientes } = await supabase
                .from('envios_log')
                .select('deuda_id, sent_at, tipo_destino, referencia_id')
                .in('deuda_id', deudaIds)
                .order('sent_at', { ascending: false })
                .limit(deudaIds.length * 5)

            enviosRecientes?.forEach(e => {
                const arr = enviosPorDeuda.get(e.deuda_id) || []
                arr.push(e)
                enviosPorDeuda.set(e.deuda_id, arr)
            })
        }

        // 2b. Cargar pagos recientes para determinar si ya pagó este período
        let pagosPorDeuda = new Map<string, string>()
        if (deudaIds.length > 0) {
            const { data: pagosRecientes } = await supabase
                .from('pagos')
                .select('deuda_id, created_at')
                .in('deuda_id', deudaIds)
                .order('created_at', { ascending: false })

            pagosRecientes?.forEach(p => {
                if (!pagosPorDeuda.has(p.deuda_id)) {
                    pagosPorDeuda.set(p.deuda_id, p.created_at)
                }
            })
        }

        // 3. Obtener plantillas activas
        const { data: plantillas } = await supabase
            .from('plantillas_mensaje')
            .select('*')
            .eq('activo', true)

        // 4. Obtener webhook activo
        const { data: webhook } = await supabase
            .from('webhooks')
            .select('*')
            .eq('activo', true)
            .maybeSingle()

        if (!webhook) {
            return NextResponse.json({ ok: false, message: 'No hay webhook activo' })
        }

        let procesadas = 0
        let omitidos = 0

        type TareaEnvio = () => Promise<{ estado: 'enviado' | 'error' }>
        const tareasEnvio: TareaEnvio[] = []

        for (const deuda of deudas ?? []) {
            const config = deuda.configuracion
            if (!config) continue

            // Usar etapa y dias_atraso de la DB (ya actualizados por el RPC) — evita inconsistencia de timezone
            const etapaActual: EtapaCobranza = deuda.etapa as EtapaCobranza
            const diasAtraso: number = deuda.dias_atraso
            const enviosDeuda = enviosPorDeuda.get(deuda.id) ?? []
            const ultimoEnvioCliente = enviosDeuda
                .filter(e => e.tipo_destino === 'cliente')
                .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0]?.sent_at ?? null
            const esPrimerEnvioCliente = !ultimoEnvioCliente

            // Verificar si el cliente ya pagó este período
            const ultimoPago = pagosPorDeuda.get(deuda.id)
            // Regla: para la PRIMERA notificación no bloquear por pago reciente.
            // Esto evita que deudas existentes sin historial de envíos se queden sin su primer recordatorio.
            if (ultimoPago && !esPrimerEnvioCliente) {
                const fechaPago = new Date(ultimoPago)
                const ahora = new Date()
                const diasDesdePago = (ahora.getTime() - fechaPago.getTime()) / (1000 * 60 * 60 * 24)
                const freq = (deuda.frecuencia_pago as FrecuenciaPago) ?? 'mensual'
                const umbral = freq === 'semanal' ? 5 : freq === 'quincenal' ? 12 : 25
                if (diasDesdePago < umbral) {
                    omitidos++
                    continue
                }
            }

            // Para preventivo, verificar si estamos dentro de la ventana de dias_antes_vencimiento
            // Para primer envío no aplicamos esta ventana para destrabar pendientes históricos.
            if (etapaActual === 'preventivo' && !esPrimerEnvioCliente) {
                if (!debeEnviarPreventivo(deuda.fecha_corte, config.dias_antes_vencimiento)) {
                    omitidos++
                    continue
                }
            }

            // Anti-duplicado para envío al cliente
            const intervalo = getIntervaloEnvio(etapaActual, config)

            if (!debeEnviar(ultimoEnvioCliente, intervalo)) {
                omitidos++
                continue
            }

            const plantilla = plantillas?.find(p => p.etapa === etapaActual)
            if (!plantilla) { omitidos++; continue }

            procesadas++

            const cuotaDisplay = deuda.cuota_mensual
                ? formatMonto(deuda.cuota_mensual)
                : formatMonto(deuda.saldo_pendiente)

            const variables = {
                nombre: deuda.cliente.nombre,
                apellido: deuda.cliente.apellido,
                monto: formatMonto(deuda.monto_original),
                saldo: formatMonto(deuda.saldo_pendiente),
                cuota: cuotaDisplay,
                fecha_corte: formatFecha(deuda.fecha_corte),
                dias_atraso: diasAtraso,
                tasa_interes: deuda.tasa_interes,
                agente: deuda.agente?.full_name ?? 'Inversiones Cordero',
            }

            const mensajeRendered = renderTemplate(plantilla.contenido, variables)
            const payload: WebhookPayload = {
                evento: 'recordatorio_cobranza',
                timestamp: new Date().toISOString(),
                enviado_por: 'cron',
                etapa: etapaActual,
                tipo_destino: 'cliente',
                cliente: {
                    id: deuda.cliente.id,
                    nombre: deuda.cliente.nombre,
                    apellido: deuda.cliente.apellido,
                    telefono: deuda.cliente.telefono,
                    email: deuda.cliente.email,
                },
                deuda: {
                    id: deuda.id,
                    monto_original: deuda.monto_original,
                    saldo_pendiente: deuda.saldo_pendiente,
                    cuota_mensual: deuda.cuota_mensual,
                    tasa_interes: deuda.tasa_interes,
                    fecha_corte: deuda.fecha_corte,
                    dias_atraso: diasAtraso,
                    frecuencia_pago: deuda.frecuencia_pago,
                },
                mensaje: mensajeRendered,
                agente: deuda.agente ? { id: deuda.agente.id, nombre: deuda.agente.full_name } : undefined,
            }

            tareasEnvio.push(() => procesarEnvio(supabase, webhook, payload, {
                deuda_id: deuda.id,
                cliente_id: deuda.cliente_id,
                webhook_id: webhook.id,
                plantilla_id: plantilla.id,
                etapa: etapaActual,
                mensaje_enviado: mensajeRendered,
                payload,
                tipo_destino: 'cliente',
                enviado_por: 'cron',
            }))

        }

        // Ejecutar en lotes
        let enviados = 0
        let errores = 0

        for (let i = 0; i < tareasEnvio.length; i += BATCH_SIZE) {
            const batch = tareasEnvio.slice(i, i + BATCH_SIZE)
            const resultados = await Promise.allSettled(batch.map(fn => fn()))

            for (const res of resultados) {
                if (res.status === 'fulfilled' && res.value.estado === 'enviado') {
                    enviados++
                } else {
                    errores++
                }
            }
        }

        return NextResponse.json({
            ok: true,
            timestamp: new Date().toISOString(),
            total_deudas: deudas?.length ?? 0,
            procesadas,
            enviados,
            omitidos,
            errores,
        })
    } catch (error) {
        console.error('[CRON] Error:', error)
        return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
    }
}
