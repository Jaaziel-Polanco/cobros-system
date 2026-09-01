'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { WebhookSchema, WebhookFormData } from '@/lib/validations/schemas'
import { generarTicketPdf } from '@/lib/pdf/ticket-document'
import type { ConfiguracionTicket, EventoWebhook } from '@/lib/types'
import {
    CFG_TICKET_POR_DEFECTO,
    construirPayloadPruebaCobranza,
    construirPayloadPruebaTicket,
    construirTicketDePrueba,
    payloadParaMostrar,
    telefonoDePrueba,
    type PayloadPrueba,
    type PruebaWebhook,
    type PruebaArmada,
    type ResultadoPruebaWebhook,
    type SorteoDePrueba,
} from '@/lib/webhooks/payload-prueba'

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

// ─── PRUEBA DE WEBHOOK ────────────────────────────────────────

/**
 * Empaqueta el payload completo (el que viaja) junto con la vista que va a
 * pantalla (el mismo, con el base64 elidido) para que no se puedan
 * desincronizar: salen los dos de la misma construcción.
 */
function empaquetar(
    evento: EventoWebhook,
    payload: PayloadPrueba,
    avisos: string[],
): PruebaArmada {
    const mostrable = payloadParaMostrar(payload)
    return {
        completo: payload,
        vista: {
            evento,
            payload: mostrable.payload,
            adjunto: mostrable.adjunto,
            avisos,
        },
    }
}

async function armarPruebaCobranza(): Promise<PruebaArmada> {
    const supabase = await createClient()
    const avisos: string[] = []

    const { data: cfg } = await supabase
        .from('configuracion_ticket')
        .select('telefono')
        .eq('id', true)
        .maybeSingle()

    const { data: plantilla } = await supabase
        .from('plantillas_mensaje')
        .select('contenido')
        .eq('etapa', 'mora_temprana')
        .eq('activo', true)
        .maybeSingle()

    if (!plantilla) {
        avisos.push(
            'No hay plantilla activa de «mora temprana»: la prueba usa un ' +
            'texto de ejemplo en vez del mensaje real.',
        )
    }

    const telefono = telefonoDePrueba(cfg)
    avisos.push(
        `El teléfono de la prueba es ${telefono}. Si tu flujo de n8n no corta ` +
        'cuando `_test` es true, el mensaje llegará a ese número.',
    )

    const payload = construirPayloadPruebaCobranza({
        telefono,
        plantillaContenido: plantilla?.contenido,
    })

    return empaquetar('cobranza', payload, avisos)
}

async function armarPruebaTicket(): Promise<PruebaArmada> {
    const supabase = await createClient()
    const avisos: string[] = []

    const { data: cfgFila } = await supabase
        .from('configuracion_ticket')
        .select('*')
        .eq('id', true)
        .maybeSingle()

    const cfg = (cfgFila as ConfiguracionTicket | null) ?? CFG_TICKET_POR_DEFECTO
    if (!cfgFila) {
        avisos.push(
            'El módulo de boletos no está configurado todavía: el PDF sale ' +
            'con datos de ejemplo en la cabecera.',
        )
    }

    const { data: plantilla } = await supabase
        .from('plantillas_mensaje')
        .select('contenido')
        .eq('etapa', 'ticket')
        .eq('activo', true)
        .maybeSingle()

    if (!plantilla) {
        avisos.push(
            'No hay plantilla activa de boletos: la prueba usa un texto de ' +
            'ejemplo en vez del mensaje real.',
        )
    }

    // Se prefiere el sorteo ACTIVO porque es el único que usaría
    // `emitir_ticket`. Si no hay ninguno, se cae al borrador más reciente:
    // la prueba sigue siendo la del flujo real, pero el mensaje y el PDF
    // salen con el nombre y el prefijo que de verdad se van a usar, que es
    // lo que se quiere ver antes de abrir el sorteo. La diferencia se dice
    // en un aviso, no se disimula.
    const { data: sorteosFila } = await supabase
        .from('sorteos')
        .select('id, nombre, premio, fecha_fin, prefijo, estado, created_at')
        .in('estado', ['activo', 'borrador'])
        .order('created_at', { ascending: false })
        .limit(50)

    const candidatos = (sorteosFila ?? []) as (SorteoDePrueba & { estado: string })[]
    const sorteo =
        candidatos.find(s => s.estado === 'activo') ??
        candidatos.find(s => s.estado === 'borrador') ??
        null

    if (!sorteo) {
        avisos.push(
            'No hay ningún sorteo activo ni en borrador: el boleto de prueba ' +
            'usa un sorteo ficticio y la numeración sin sorteo (SN).',
        )
    } else if (sorteo.estado !== 'activo') {
        avisos.push(
            `No hay ningún sorteo activo, así que la prueba usa «${sorteo.nombre}», ` +
            'que está en borrador. Un boleto real no se emitiría hasta que lo actives.',
        )
    }

    const ticket = construirTicketDePrueba(cfg, sorteo)

    // El `modo_adjunto` se respeta tal cual para que la prueba sea el envío
    // real y no una versión favorecida de él. Si excluye el base64, se dice
    // en pantalla en vez de mandar un PDF que producción no mandaría.
    const incluirBase64 = cfg.modo_adjunto === 'base64' || cfg.modo_adjunto === 'ambos'
    const incluirUrl = cfg.modo_adjunto === 'url' || cfg.modo_adjunto === 'ambos'

    if (!incluirBase64) {
        avisos.push(
            `El modo de adjunto configurado es «${cfg.modo_adjunto}», así que ` +
            'esta prueba NO lleva el PDF en base64 — igual que el envío real. ' +
            'Cámbialo en Configuración → Boletos si necesitas el adjunto.',
        )
    }

    let base64: string | null = null
    if (incluirBase64) {
        // Se genera con el mismo TicketDocument de producción: si el PDF
        // reventara (una fuente, un logo inalcanzable), revienta aquí y no
        // el día que se emita un boleto de verdad.
        const pdf = await generarTicketPdf(ticket)
        base64 = pdf.toString('base64')
    }

    const base = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000'
    const urlPublica = incluirUrl ? `${base}/t/${ticket.token_publico}` : null
    if (incluirUrl) {
        avisos.push(
            `La \`url_publica\` apunta al boleto de ejemplo (${urlPublica}). ` +
            'Es una página real y pública, con datos ficticios: sirve para ' +
            'probar el botón de la plantilla de WhatsApp.',
        )
    }

    avisos.push(
        `El teléfono de la prueba es ${ticket.snapshot.cliente.telefono}. Si ` +
        'tu flujo de n8n no corta cuando `_test` es true, el WhatsApp con el ' +
        'boleto llegará a ese número.',
    )

    const payload = construirPayloadPruebaTicket({
        ticket,
        cfg,
        plantillaContenido: plantilla?.contenido,
        base64,
        urlPublica,
    })

    return empaquetar('ticket', payload, avisos)
}

/** Arma la prueba que le corresponde al `evento` del webhook. */
async function armarPrueba(evento: EventoWebhook): Promise<PruebaArmada> {
    return evento === 'ticket' ? armarPruebaTicket() : armarPruebaCobranza()
}

async function leerWebhook(id: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('webhooks')
        .select('*')
        .eq('id', id)
        .single()

    // RLS sobre `webhooks` sólo deja pasar al admin, y filtra en silencio:
    // un no-admin llega aquí con `data` nulo y un error de "0 filas", no con
    // uno de permisos. El mensaje lo dice para que no se lea como "el
    // webhook se borró".
    if (error || !data) {
        throw new Error(
            'No se encontró el webhook, o tu usuario no tiene permiso para verlo.',
        )
    }
    return data
}

/**
 * Previsualiza el payload de prueba SIN enviarlo.
 *
 * Genera el PDF de verdad aunque no se mande: así la previsualización ya
 * delata un fallo de generación, y el tamaño que se muestra en pantalla es
 * el que va a viajar, no una estimación.
 */
export async function previsualizarPruebaWebhook(id: string): Promise<PruebaWebhook> {
    const webhook = await leerWebhook(id)
    const { vista } = await armarPrueba(webhook.evento as EventoWebhook)
    return vista
}

export async function testWebhook(id: string): Promise<ResultadoPruebaWebhook> {
    const webhook = await leerWebhook(id)

    // El payload lo decide el `evento` del webhook. Antes se enviaba siempre
    // el de cobranza, con lo que probar el webhook de Boletos no ejercitaba
    // ni una línea del flujo de boletos.
    const { vista, completo } = await armarPrueba(webhook.evento as EventoWebhook)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)

    try {
        const resp = await fetch(webhook.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...webhook.headers },
            body: JSON.stringify(completo),
            signal: controller.signal,
        })

        let respBody: string | undefined
        try { respBody = (await resp.text()).slice(0, 2000) } catch { /* ignore */ }

        return { ...vista, status: resp.status, ok: resp.ok, body: respBody }
    } catch (e) {
        return {
            ...vista,
            status: 0,
            ok: false,
            body: e instanceof DOMException && e.name === 'AbortError'
                ? 'Timeout: el webhook no respondió en 30 segundos'
                : String(e),
        }
    } finally {
        clearTimeout(timer)
    }
}
