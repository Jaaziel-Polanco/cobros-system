'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ReferenciaSchema, ReferenciaFormData } from '@/lib/validations/schemas'
import { renderTemplate, formatMonto, formatFecha } from '@/lib/utils/template-renderer'
import { WebhookPayload } from '@/lib/types'

export async function getReferencias(clienteId?: string) {
    const supabase = await createClient()
    let query = supabase
        .from('referencias_cliente')
        .select(`*, cliente:clientes(id, nombre, apellido)`)
        .order('created_at', { ascending: false })

    if (clienteId) query = query.eq('cliente_id', clienteId)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return data
}

export async function createReferencia(formData: ReferenciaFormData) {
    const supabase = await createClient()
    const validated = ReferenciaSchema.parse(formData)
    const { data, error } = await supabase
        .from('referencias_cliente')
        .insert({
            ...validated,
            relacion: validated.relacion || null,
            notas: validated.notas || null,
        })
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/referencias')
    revalidatePath(`/clientes/${validated.cliente_id}`)
    return data
}

export async function updateReferencia(id: string, formData: Partial<ReferenciaFormData>) {
    const supabase = await createClient()
    const validated = ReferenciaSchema.partial().parse(formData)

    const payload: Record<string, unknown> = { ...validated }
    if (validated.relacion !== undefined) payload.relacion = validated.relacion || null
    if (validated.notas !== undefined) payload.notas = validated.notas || null

    const { data, error } = await supabase
        .from('referencias_cliente')
        .update(payload)
        .eq('id', id)
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/referencias')
    return data
}

export async function deleteReferencia(id: string) {
    const supabase = await createClient()
    const { error } = await supabase.from('referencias_cliente').delete().eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/referencias')
}

export async function enviarNotificacionReferencia(referenciaId: string, deudaId: string) {
    const supabase = await createClient()

    const { data: ref, error: refError } = await supabase
        .from('referencias_cliente')
        .select('*, cliente:clientes(*)')
        .eq('id', referenciaId)
        .single()

    if (refError || !ref) throw new Error('Referencia no encontrada')

    const { data: deuda, error: deudaError } = await supabase
        .from('deudas')
        .select('*, agente:profiles(id, full_name)')
        .eq('id', deudaId)
        .single()

    if (deudaError || !deuda) throw new Error('Deuda no encontrada')

    const { data: plantilla } = await supabase
        .from('plantillas_mensaje')
        .select('*')
        .eq('etapa', 'referencia')
        .eq('activo', true)
        .maybeSingle()

    if (!plantilla) throw new Error('No hay plantilla activa para referencias')

    const { data: webhook } = await supabase
        .from('webhooks')
        .select('*')
        .eq('activo', true)
        .maybeSingle()

    if (!webhook) throw new Error('No hay webhook activo configurado')

    const variables = {
        nombre: ref.cliente.nombre,
        apellido: ref.cliente.apellido,
        monto: formatMonto(deuda.monto_original),
        saldo: formatMonto(deuda.saldo_pendiente),
        cuota: deuda.cuota_mensual ? formatMonto(deuda.cuota_mensual) : formatMonto(deuda.saldo_pendiente),
        fecha_corte: formatFecha(deuda.fecha_corte),
        dias_atraso: deuda.dias_atraso,
        tasa_interes: deuda.tasa_interes,
        agente: deuda.agente?.full_name ?? 'Inversiones Cordero',
        nombre_referencia: ref.nombre,
        relacion: ref.relacion ?? '',
    }

    const mensajeRendered = renderTemplate(plantilla.contenido, variables)

    const payload: WebhookPayload = {
        evento: 'recordatorio_cobranza',
        timestamp: new Date().toISOString(),
        enviado_por: 'manual',
        etapa: deuda.etapa,
        tipo_destino: 'referencia',
        cliente: {
            id: ref.cliente.id,
            nombre: ref.cliente.nombre,
            apellido: ref.cliente.apellido,
            telefono: ref.cliente.telefono,
            email: ref.cliente.email,
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
        referencia: { id: ref.id, nombre: ref.nombre, telefono: ref.telefono, relacion: ref.relacion },
        agente: deuda.agente ? { id: deuda.agente.id, nombre: deuda.agente.full_name } : undefined,
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    let result: { ok: boolean; status: number; body: string }
    try {
        const resp = await fetch(webhook.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...webhook.headers },
            body: JSON.stringify(payload),
            signal: controller.signal,
        })
        result = { ok: resp.ok, status: resp.status, body: await resp.text() }
    } catch (e) {
        result = { ok: false, status: 0, body: String(e) }
    } finally {
        clearTimeout(timer)
    }

    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('envios_log').insert({
        deuda_id: deuda.id,
        cliente_id: ref.cliente_id,
        webhook_id: webhook.id,
        plantilla_id: plantilla.id,
        etapa: deuda.etapa,
        mensaje_enviado: mensajeRendered,
        payload,
        tipo_destino: 'referencia',
        referencia_id: ref.id,
        estado: result.ok ? 'enviado' : 'error',
        respuesta_http: result.status || undefined,
        respuesta_body: result.body,
        enviado_por: 'manual',
        agente_id: user?.id,
    })

    revalidatePath('/referencias')
    revalidatePath('/logs')

    if (!result.ok) throw new Error(`Error al enviar: HTTP ${result.status}`)
    return { ok: true }
}

export async function getDeudasPorCliente(clienteId: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('deudas')
        .select('id, monto_original, saldo_pendiente, fecha_corte, etapa, estado')
        .eq('cliente_id', clienteId)
        .eq('estado', 'activo')
        .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)
    return data ?? []
}
