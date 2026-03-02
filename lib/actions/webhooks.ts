'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { WebhookSchema, WebhookFormData } from '@/lib/validations/schemas'

export async function getWebhooks() {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('webhooks')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)
    return data
}

export async function createWebhook(formData: WebhookFormData) {
    const supabase = await createClient()
    const validated = WebhookSchema.parse(formData)
    const { data, error } = await supabase
        .from('webhooks')
        .insert({ ...validated, descripcion: validated.descripcion || null })
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/webhooks')
    return data
}

export async function updateWebhook(id: string, formData: WebhookFormData) {
    const supabase = await createClient()
    const validated = WebhookSchema.parse(formData)
    const { data, error } = await supabase
        .from('webhooks')
        .update({ ...validated, descripcion: validated.descripcion || null })
        .eq('id', id)
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/webhooks')
    return data
}

export async function deleteWebhook(id: string) {
    const supabase = await createClient()
    const { error } = await supabase.from('webhooks').delete().eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/webhooks')
}

export async function testWebhook(id: string) {
    const supabase = await createClient()
    const { data: webhook, error } = await supabase
        .from('webhooks')
        .select('*')
        .eq('id', id)
        .single()

    if (error || !webhook) throw new Error('Webhook no encontrado')

    const testPayload = {
        evento: 'test_conexion',
        timestamp: new Date().toISOString(),
        enviado_por: 'manual',
        etapa: 'mora_temprana',
        tipo_destino: 'cliente',
        cliente: {
            id: '00000000-0000-0000-0000-000000000001',
            nombre: 'Juan',
            apellido: 'Pérez',
            telefono: '809-555-1234',
            email: 'juan.perez@ejemplo.com',
        },
        deuda: {
            id: '00000000-0000-0000-0000-000000000002',
            monto_original: 50000.00,
            saldo_pendiente: 35000.00,
            tasa_interes: 2.5,
            fecha_corte: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
            dias_atraso: 15,
        },
        mensaje: 'Prueba de conexión desde Inversiones Cordero — Plataforma de Cobranza. Este es un envío de prueba con datos ficticios.',
        agente: {
            id: '00000000-0000-0000-0000-000000000003',
            nombre: 'Agente de Prueba',
        },
        _test: true,
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)

    try {
        const resp = await fetch(webhook.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...webhook.headers },
            body: JSON.stringify(testPayload),
            signal: controller.signal,
        })

        let respBody: string | undefined
        try { respBody = await resp.text() } catch { /* ignore */ }

        return { status: resp.status, ok: resp.ok, body: respBody }
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
            return { status: 0, ok: false, body: 'Timeout: el webhook no respondió en 15 segundos' }
        }
        throw e
    } finally {
        clearTimeout(timer)
    }
}
