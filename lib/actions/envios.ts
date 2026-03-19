'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { renderTemplate, formatMonto, formatFecha } from '@/lib/utils/template-renderer'
import { WebhookPayload, EtapaCobranza } from '@/lib/types'
import { debeEnviarPreventivo } from '@/lib/utils/cobranza-engine'

export async function getLogs(filters?: {
    clienteId?: string
    etapa?: string
    estado?: string
    desde?: string
    hasta?: string
}) {
    const supabase = await createClient()
    let query = supabase
        .from('envios_log')
        .select(`
      *,
      cliente:clientes(id, nombre, apellido),
      agente:profiles(id, full_name),
      deuda:deudas(id, monto_original, saldo_pendiente)
    `)
        .order('sent_at', { ascending: false })
        .limit(200)

    if (filters?.clienteId) query = query.eq('cliente_id', filters.clienteId)
    if (filters?.etapa) query = query.eq('etapa', filters.etapa)
    if (filters?.estado) query = query.eq('estado', filters.estado)
    if (filters?.desde) query = query.gte('sent_at', filters.desde)
    if (filters?.hasta) query = query.lte('sent_at', filters.hasta)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return data
}

async function fetchWebhookConTimeout(url: string, headers: Record<string, string>, payload: unknown) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(payload),
            signal: controller.signal,
        })
        const body = await resp.text()
        return { ok: resp.ok, status: resp.status, body }
    } catch (e) {
        return {
            ok: false,
            status: 0,
            body: e instanceof DOMException && e.name === 'AbortError'
                ? 'Timeout: el webhook no respondió en 15 segundos'
                : String(e),
        }
    } finally {
        clearTimeout(timer)
    }
}

export async function enviarRecordatorioManual(deudaId: string) {
    const supabase = await createClient()

    const { data: deuda, error: deudaError } = await supabase
        .from('deudas')
        .select(`
      *,
      cliente:clientes(*),
      agente:profiles(id, full_name),
      configuracion:configuracion_recordatorio(*)
    `)
        .eq('id', deudaId)
        .single()

    if (deudaError || !deuda) throw new Error('Deuda no encontrada')
    if (deuda.estado === 'saldado') throw new Error('La deuda ya está saldada')
    if (deuda.pausado) throw new Error('La deuda está pausada')

    const { data: plantilla } = await supabase
        .from('plantillas_mensaje')
        .select('*')
        .eq('etapa', deuda.etapa)
        .eq('activo', true)
        .maybeSingle()

    if (!plantilla) throw new Error(`No hay plantilla activa para etapa: ${deuda.etapa}`)

    const { data: webhook } = await supabase
        .from('webhooks')
        .select('*')
        .eq('activo', true)
        .maybeSingle()

    if (!webhook) throw new Error('No hay webhook activo configurado')

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
        dias_atraso: deuda.dias_atraso,
        tasa_interes: deuda.tasa_interes,
        agente: deuda.agente?.full_name ?? 'Inversiones Cordero',
    }

    const mensajeRendered = renderTemplate(plantilla.contenido, variables)

    const payload: WebhookPayload = {
        evento: 'recordatorio_cobranza',
        timestamp: new Date().toISOString(),
        enviado_por: 'manual',
        etapa: deuda.etapa,
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
            dias_atraso: deuda.dias_atraso,
            frecuencia_pago: deuda.frecuencia_pago,
        },
        mensaje: mensajeRendered,
        agente: deuda.agente
            ? { id: deuda.agente.id, nombre: deuda.agente.full_name }
            : undefined,
    }

    const result = await fetchWebhookConTimeout(webhook.url, webhook.headers, payload)
    const estado: 'enviado' | 'error' = result.ok ? 'enviado' : 'error'

    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('envios_log').insert({
        deuda_id: deuda.id,
        cliente_id: deuda.cliente_id,
        webhook_id: webhook.id,
        plantilla_id: plantilla.id,
        etapa: deuda.etapa,
        mensaje_enviado: mensajeRendered,
        payload,
        tipo_destino: 'cliente',
        estado,
        respuesta_http: result.status || undefined,
        respuesta_body: result.body,
        enviado_por: 'manual',
        agente_id: user?.id,
    })

    revalidatePath('/logs')
    revalidatePath('/cuentas')

    if (estado === 'error') throw new Error(`Webhook respondió con error ${result.status}: ${result.body}`)

    return { ok: true, estado, respuesta_http: result.status }
}

/**
 * Intenta enviar la primera notificación de una deuda recién creada
 * si estamos dentro del horario laboral y la deuda califica.
 * Se ejecuta en background (fire-and-forget) — no bloquea la creación.
 * Retorna silenciosamente si no aplica o falla.
 */
export async function intentarEnvioInmediato(deudaId: string): Promise<void> {
    console.log(`[ENVIO_INMEDIATO] Iniciando para deuda ${deudaId}`)
    try {
        const supabase = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        const { data: deuda, error: deudaErr } = await supabase
            .from('deudas')
            .select(`
                *,
                cliente:clientes(*)
            `)
            .eq('id', deudaId)
            .single()

        let agenteNombre: string | null = null
        if (deuda?.agente_id) {
            const { data: ag } = await supabase
                .from('profiles')
                .select('id, full_name')
                .eq('id', deuda.agente_id)
                .single()
            agenteNombre = ag?.full_name ?? null
        }

        if (deudaErr) {
            console.error(`[ENVIO_INMEDIATO] Error leyendo deuda:`, deudaErr.message)
            return
        }

        if (!deuda || deuda.estado !== 'activo' || deuda.pausado) {
            console.log(`[ENVIO_INMEDIATO] Deuda no califica: estado=${deuda?.estado} pausado=${deuda?.pausado}`)
            return
        }

        const { data: config } = await supabase
            .from('configuracion_recordatorio')
            .select('*')
            .eq('deuda_id', deudaId)
            .maybeSingle()

        const etapa = deuda.etapa as EtapaCobranza
        console.log(`[ENVIO_INMEDIATO] Deuda ${deudaId}: etapa=${etapa}, dias_atraso=${deuda.dias_atraso}`)

        if (etapa === 'saldado') {
            console.log(`[ENVIO_INMEDIATO] Deuda saldada, omitida`)
            return
        }

        if (etapa === 'preventivo' && config) {
            if (!debeEnviarPreventivo(deuda.fecha_corte, config.dias_antes_vencimiento)) {
                console.log(`[ENVIO_INMEDIATO] Preventivo fuera de ventana, omitida`)
                return
            }
        }

        const { data: plantilla } = await supabase
            .from('plantillas_mensaje')
            .select('*')
            .eq('etapa', etapa)
            .eq('activo', true)
            .maybeSingle()

        if (!plantilla) {
            console.error(`[ENVIO_INMEDIATO] No hay plantilla activa para etapa "${etapa}"`)
            return
        }

        const { data: webhook } = await supabase
            .from('webhooks')
            .select('*')
            .eq('activo', true)
            .maybeSingle()

        if (!webhook) {
            console.error(`[ENVIO_INMEDIATO] No hay webhook activo configurado`)
            return
        }

        const cuotaImm = deuda.cuota_mensual
            ? formatMonto(deuda.cuota_mensual)
            : formatMonto(deuda.saldo_pendiente)

        const variables = {
            nombre: deuda.cliente.nombre,
            apellido: deuda.cliente.apellido,
            monto: formatMonto(deuda.monto_original),
            saldo: formatMonto(deuda.saldo_pendiente),
            cuota: cuotaImm,
            fecha_corte: formatFecha(deuda.fecha_corte),
            dias_atraso: deuda.dias_atraso,
            tasa_interes: deuda.tasa_interes,
            agente: agenteNombre ?? 'Inversiones Cordero',
        }

        const mensajeRendered = renderTemplate(plantilla.contenido, variables)

        const payload: WebhookPayload = {
            evento: 'recordatorio_cobranza',
            timestamp: new Date().toISOString(),
            enviado_por: 'cron',
            etapa,
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
                dias_atraso: deuda.dias_atraso,
                frecuencia_pago: deuda.frecuencia_pago,
            },
            mensaje: mensajeRendered,
            agente: deuda.agente_id && agenteNombre
                ? { id: deuda.agente_id, nombre: agenteNombre }
                : undefined,
        }

        console.log(`[ENVIO_INMEDIATO] Enviando webhook para ${deuda.cliente.nombre} ${deuda.cliente.apellido}...`)
        const result = await fetchWebhookConTimeout(webhook.url, webhook.headers, payload)

        const { error: logErr } = await supabase.from('envios_log').insert({
            deuda_id: deuda.id,
            cliente_id: deuda.cliente_id,
            webhook_id: webhook.id,
            plantilla_id: plantilla.id,
            etapa,
            mensaje_enviado: mensajeRendered,
            payload,
            tipo_destino: 'cliente',
            estado: result.ok ? 'enviado' : 'error',
            respuesta_http: result.status || undefined,
            respuesta_body: result.body,
            enviado_por: 'cron',
            agente_id: deuda.agente_id ?? undefined,
        })

        if (logErr) console.error(`[ENVIO_INMEDIATO] Error guardando log:`, logErr.message)

        if (result.ok) {
            console.log(`[ENVIO_INMEDIATO] ✅ Notificación enviada para deuda ${deudaId} (${etapa})`)
        } else {
            console.error(`[ENVIO_INMEDIATO] ❌ Webhook falló: HTTP ${result.status} — ${result.body?.slice(0, 200)}`)
        }
    } catch (e) {
        console.error('[ENVIO_INMEDIATO] Error fatal:', e)
    }
}

export async function enviarPendientesSinNotificacion(): Promise<{ enviados: number; errores: number }> {
    const supabase = await createClient()

    const { data: deudasActivas, error } = await supabase
        .from('deudas')
        .select('id')
        .eq('estado', 'activo')
        .eq('pausado', false)
        .neq('etapa', 'saldado')

    if (error || !deudasActivas) return { enviados: 0, errores: 0 }

    const deudaIds = deudasActivas.map(d => d.id)
    if (deudaIds.length === 0) return { enviados: 0, errores: 0 }

    const { data: enviosExistentes } = await supabase
        .from('envios_log')
        .select('deuda_id')
        .in('deuda_id', deudaIds)
        .eq('tipo_destino', 'cliente')

    const deudasConEnvio = new Set(enviosExistentes?.map(e => e.deuda_id) ?? [])
    const deudasSinEnvio = deudaIds.filter(id => !deudasConEnvio.has(id))

    let enviados = 0
    let errores = 0

    for (const deudaId of deudasSinEnvio) {
        try {
            await intentarEnvioInmediato(deudaId)
            enviados++
        } catch {
            errores++
        }
    }

    return { enviados, errores }
}
