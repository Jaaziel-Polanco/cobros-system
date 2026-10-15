'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { renderTemplate, formatMonto, formatFecha } from '@/lib/utils/template-renderer'
import { WebhookPayload, EtapaCobranza } from '@/lib/types'
import { debeEnviarPreventivo, normalizarConfiguracionRecordatorio } from '@/lib/utils/cobranza-engine'

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

/**
 * Resultado de un envio manual. Que sea un valor DEVUELTO y no una excepcion
 * es lo importante: Next.js redacta en produccion el mensaje de cualquier
 * error lanzado desde una Server Action, y el cliente recibe "An error
 * occurred in the Server Components render...".
 *
 * Para un fallo de programacion esa redaccion esta bien. Para estas
 * comprobaciones no: "la deuda esta pausada" o "no hay plantilla para esta
 * etapa" son estados que el operador necesita LEER. Esconderlos detras de un
 * digest es lo que mantuvo oculto durante meses que ningun agente podia
 * enviar recordatorios: el sistema decia lo mismo para seis causas distintas.
 */
export type ResultadoEnvioManual =
    | { ok: true; estado: 'enviado'; respuesta_http: number }
    | { ok: false; motivo: string }

/**
 * Devuelve el motivo al llamante y ademas lo deja en la salida del contenedor,
 * por si Next.js no llega a registrar nada.
 */
function motivoDeFallo(deudaId: string, motivo: string): ResultadoEnvioManual {
    console.error(`[RECORDATORIO_MANUAL] deuda=${deudaId} motivo=${motivo}`)
    return { ok: false, motivo }
}

/**
 * Envío manual desde la UI: no aplica la ventana de días antes del vencimiento (override del usuario).
 * El cron y `intentarEnvioInmediato` sí respetan preventivo siempre.
 */
export async function enviarRecordatorioManual(deudaId: string): Promise<ResultadoEnvioManual> {
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

    if (deudaError || !deuda) return motivoDeFallo(deudaId, 'Deuda no encontrada')
    if (deuda.estado === 'saldado') return motivoDeFallo(deudaId, 'La deuda ya está saldada')
    if (deuda.pausado) return motivoDeFallo(deudaId, 'La deuda está pausada')

    // RLS vuelve a filtrar en silencio, y aqui duele mas que en `webhooks`.
    // La policy de `deudas` deja ver las del propio agente; la de `clientes`,
    // los clientes del propio agente. Son dos condiciones DISTINTAS, y en
    // cuanto una deuda y su cliente estan asignados a agentes diferentes, el
    // agente ve la deuda pero el embed `cliente:clientes(*)` le llega null.
    //
    // No es hipotetico: en produccion hay una deuda asi. El codigo hacia
    // `deuda.cliente.nombre` y reventaba con "Cannot read properties of null",
    // que en produccion se ve como el mismo digest opaco de siempre.
    //
    // Un embed que puede ser null por RLS no se desreferencia sin mirar.
    if (!deuda.cliente) {
        return motivoDeFallo(deudaId,
            'El cliente de esta cuenta esta asignado a otro agente, asi que no puedes verlo. ' +
            'Pide a un administrador que reasigne el cliente o la cuenta.')
    }

    const { data: plantilla } = await supabase
        .from('plantillas_mensaje')
        .select('*')
        .eq('etapa', deuda.etapa)
        .eq('activo', true)
        .maybeSingle()

    if (!plantilla) return motivoDeFallo(deudaId, `No hay plantilla activa para la etapa "${deuda.etapa}"`)

    // `webhooks` tiene RLS activo y una unica policy: «webhooks: admin full
    // access». No hay ninguna de lectura para agentes, y RLS no da error --
    // FILTRA. Con el cliente de sesion un agente recibia `data: null,
    // error: null`, indistinguible de "no hay webhook configurado", asi que
    // esta accion lanzaba y Next.js redactaba el mensaje en produccion.
    // Resultado medido: 0 recordatorios manuales enviados por agentes en
    // toda la vida del sistema. Los automaticos nunca se vieron afectados
    // porque el cron e `intentarEnvioInmediato` ya van por service_role.
    //
    // El destino del webhook es configuracion del sistema, no un dato del
    // agente: se lee con el cliente admin y no sale del servidor. Quien
    // puede disparar el envio ya lo decide la policy de `deudas`, que solo
    // deja ver las del propio agente; y `ver_webhooks` sigue gobernando la
    // pantalla de webhooks, que es lo que de verdad hay que proteger.
    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: webhook } = await admin
        .from('webhooks')
        .select('*')
        .eq('activo', true)
        .eq('evento', 'cobranza')
        .maybeSingle()

    if (!webhook) return motivoDeFallo(deudaId, 'No hay webhook activo para el evento "cobranza"')

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

    // Este si queda registrado en envios_log antes de devolverse: el envio
    // se intento de verdad y hay rastro del intento fallido.
    if (estado === 'error') {
        return motivoDeFallo(deudaId, `El webhook respondió ${result.status}: ${result.body}`)
    }

    return { ok: true, estado: 'enviado', respuesta_http: result.status }
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

        const conf = normalizarConfiguracionRecordatorio(config)
        if (etapa === 'preventivo') {
            if (!debeEnviarPreventivo(deuda.fecha_corte, conf.dias_antes_vencimiento)) {
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
            .eq('evento', 'cobranza')
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
