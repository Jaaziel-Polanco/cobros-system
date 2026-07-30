'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { getPermisos } from '@/lib/utils/permisos'
import {
    TicketManualSchema,
    AnularTicketSchema,
    type TicketManualFormData,
} from '@/lib/validations/tickets'
import type { Ticket, TicketEvento, Pago, Rol } from '@/lib/types'
import { renderTemplate } from '@/lib/utils/template-renderer'
import { generarTicketPdf } from '@/lib/pdf/ticket-document'
import { formatearFechaHoraRD, rangoRDaUTC } from '@/lib/utils/fecha-rd'
import type { TicketWebhookPayload, ConfiguracionTicket } from '@/lib/types'

/**
 * Cliente admin (service_role), sin sesión de usuario.
 *
 * Se usa exclusivamente para leer `webhooks` (C1: la única policy de esa
 * tabla es "admin acceso total"; los agentes no deben poder leerla en
 * absoluto porque `headers` puede llevar credenciales del proveedor de
 * WhatsApp) y para dejar rastro en `ticket_eventos` de fallos que ocurren
 * antes de saber si el usuario tiene permiso de escribir esa fila (I7).
 * No reemplaza las comprobaciones de permiso en TypeScript: siguen todas
 * en el cliente de sesión, más arriba en cada función.
 */
function crearClienteAdmin() {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )
}

/**
 * Registra en ticket_eventos un fallo de precondición del envío por
 * WhatsApp (boleto anulado, teléfono inválido, falta configuración,
 * falta plantilla, falta webhook) ANTES de lanzar el error. Sin esto,
 * los fallos que ocurrían antes del insert de evento no dejaban ningún
 * rastro (I7) — justo el tipo de fallo que había hecho invisible el
 * problema C1. Usa el cliente admin para no depender de las policies del
 * usuario que está fallando.
 */
async function registrarFalloPrecondicionEnvio(
    ticketId: string,
    detalle: string,
    usuarioId: string,
    reenvio: boolean,
): Promise<void> {
    const admin = crearClienteAdmin()
    await admin.from('ticket_eventos').insert({
        ticket_id: ticketId,
        tipo: 'enviado_wa',
        estado: 'error',
        es_copia: reenvio,
        detalle,
        usuario_id: usuarioId,
    })
}

/** Lee el perfil del usuario de la sesión. Lanza si no hay sesión. */
async function perfilActual() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: profile } = await supabase
        .from('profiles')
        .select('id, rol, permisos')
        .eq('id', user.id)
        .single()

    if (!profile) throw new Error('Perfil no encontrado')
    return { supabase, user, profile, permisos: getPermisos(profile) }
}

/**
 * Verifica que el usuario actual pueda operar sobre el cliente dado antes
 * de emitir un boleto en su nombre. El admin puede sobre cualquier cliente;
 * un agente, solo sobre los que tiene asignados (clientes.agente_id).
 *
 * Hace falta este chequeo aquí, en TypeScript, porque emitir_ticket() es
 * SECURITY DEFINER: corre con los privilegios del dueño de la función y no
 * pasa por las policies RLS de `clientes` ni de `tickets`. Sin esto,
 * cualquier agente podría emitir un boleto —y quemar un número del sorteo
 * activo compartido— a nombre del cliente de otro agente, con el único
 * requisito de conocer su UUID.
 */
async function verificarPropiedadCliente(
    supabase: Awaited<ReturnType<typeof createClient>>,
    rol: Rol,
    userId: string,
    clienteId: string,
): Promise<void> {
    if (rol === 'admin') return

    const { data: cliente, error } = await supabase
        .from('clientes')
        .select('agente_id')
        .eq('id', clienteId)
        .single()

    if (error || !cliente) throw new Error('Cliente no encontrado')
    if (cliente.agente_id !== userId) {
        throw new Error('No tienes permiso para operar sobre este cliente')
    }
}

// ─── EMISIÓN ──────────────────────────────────────────────────

/**
 * Emite el boleto correspondiente a un pago ya registrado.
 * Es idempotente: si el pago ya tiene boleto vigente, lo devuelve.
 */
export async function emitirTicketDePago(
    pagoId: string,
): Promise<{ ticket: Ticket; yaExistia: boolean }> {
    const { supabase, user, profile, permisos } = await perfilActual()

    // Flujo automático: se dispara desde el modal que sale justo después de
    // registrar un pago. Se gatea con ver_tickets, no con
    // generar_ticket_manual: ese permiso significa "no puede crear boletos
    // de la nada" y es para emitirTicketManual/anularTicket, que crean o
    // destruyen boletos FUERA del flujo de cobro. Gatear el flujo normal
    // con generar_ticket_manual le rompería el cobro a cualquier agente al
    // que se le quite ese permiso. Si un agente no puede ni ver boletos, no
    // tiene sentido emitirle uno; y el derecho a registrar el pago que
    // origina este boleto ya lo controla registrar_pagos aguas arriba.
    if (!permisos.ver_tickets) {
        throw new Error('No tienes permiso para emitir boletos')
    }

    const { data: pago, error: pagoError } = await supabase
        .from('pagos')
        .select('id, cliente_id, deuda_id')
        .eq('id', pagoId)
        .single()

    if (pagoError || !pago) throw new Error('Pago no encontrado')

    await verificarPropiedadCliente(supabase, profile.rol, user.id, pago.cliente_id)

    const { data, error } = await supabase.rpc('emitir_ticket', {
        p_cliente_id: pago.cliente_id,
        p_pago_id: pago.id,
        p_deuda_id: pago.deuda_id,
        p_origen: 'automatico',
        p_motivo: null,
        p_emitido_por: user.id,
    })

    if (error) throw new Error(error.message)
    if (!data?.ok) throw new Error(data?.error ?? 'No se pudo emitir el boleto')

    revalidatePath(`/clientes/${pago.cliente_id}`)
    revalidatePath('/tickets')

    return { ticket: data.ticket as Ticket, yaExistia: Boolean(data.ya_existia) }
}

/** Emite un boleto manual atado al cliente, con motivo obligatorio. */
export async function emitirTicketManual(
    input: TicketManualFormData,
): Promise<{ ticket: Ticket }> {
    const { supabase, user, profile, permisos } = await perfilActual()

    if (!permisos.generar_ticket_manual) {
        throw new Error('No tienes permiso para generar boletos manuales')
    }

    const validado = TicketManualSchema.parse(input)

    await verificarPropiedadCliente(supabase, profile.rol, user.id, validado.cliente_id)

    const { data, error } = await supabase.rpc('emitir_ticket', {
        p_cliente_id: validado.cliente_id,
        p_pago_id: null,
        p_deuda_id: null,
        p_origen: 'manual',
        p_motivo: validado.motivo,
        p_emitido_por: user.id,
    })

    if (error) throw new Error(error.message)
    if (!data?.ok) throw new Error(data?.error ?? 'No se pudo emitir el boleto')

    revalidatePath(`/clientes/${validado.cliente_id}`)
    revalidatePath('/tickets')

    return { ticket: data.ticket as Ticket }
}

// ─── ANULACIÓN ────────────────────────────────────────────────

export async function anularTicket(ticketId: string, motivo: string): Promise<void> {
    const { supabase, user, permisos } = await perfilActual()

    if (!permisos.generar_ticket_manual) {
        throw new Error('No tienes permiso para anular boletos')
    }

    const validado = AnularTicketSchema.parse({ ticket_id: ticketId, motivo })

    const { data: ticket, error: leerError } = await supabase
        .from('tickets')
        .select('id, cliente_id, estado')
        .eq('id', validado.ticket_id)
        .single()

    if (leerError || !ticket) throw new Error('Boleto no encontrado')
    if (ticket.estado === 'anulado') throw new Error('El boleto ya está anulado')

    // El UPDATE lleva la condición estado='valido' como bloqueo optimista.
    // Se exige .select().maybeSingle() sobre el resultado para comprobar que
    // de verdad afectó una fila: sin esto, una carrera donde otro proceso
    // anula el mismo boleto entre el SELECT y el UPDATE pasaría inadvertida
    // (Supabase no reporta error cuando un UPDATE afecta 0 filas) y se
    // insertaría igual un evento "anulado" falso más abajo.
    const { data: actualizado, error } = await supabase
        .from('tickets')
        .update({
            estado: 'anulado',
            anulado_por: user.id,
            anulado_at: new Date().toISOString(),
            motivo_anulacion: validado.motivo,
        })
        .eq('id', validado.ticket_id)
        .eq('estado', 'valido')      // bloqueo optimista
        .select('id')
        .maybeSingle()

    if (error) throw new Error(error.message)
    if (!actualizado) throw new Error('El boleto ya fue anulado por otro proceso')

    await supabase.from('ticket_eventos').insert({
        ticket_id: validado.ticket_id,
        tipo: 'anulado',
        estado: 'ok',
        detalle: validado.motivo,
        usuario_id: user.id,
    })

    revalidatePath(`/clientes/${ticket.cliente_id}`)
    revalidatePath('/tickets')
}

// ─── CONSULTAS ────────────────────────────────────────────────

export interface FiltrosTickets {
    busqueda?: string
    estado?: 'valido' | 'anulado'
    origen?: 'automatico' | 'manual'
    sorteoId?: string
    soloHuerfanos?: boolean
    desde?: string   // fecha RD 'YYYY-MM-DD'
    hasta?: string   // fecha RD 'YYYY-MM-DD'
}

export async function getTickets(filtros: FiltrosTickets = {}): Promise<Ticket[]> {
    const supabase = await createClient()

    let query = supabase
        .from('tickets')
        .select('*, cliente:clientes(id, nombre, apellido, telefono), sorteo:sorteos(id, nombre)')
        .order('emitido_at', { ascending: false })
        .limit(300)

    if (filtros.estado) query = query.eq('estado', filtros.estado)
    if (filtros.origen) query = query.eq('origen', filtros.origen)
    if (filtros.sorteoId) query = query.eq('sorteo_id', filtros.sorteoId)
    if (filtros.soloHuerfanos) query = query.is('sorteo_id', null)

    if (filtros.desde && filtros.hasta) {
        const { desdeISO, hastaISO } = rangoRDaUTC(filtros.desde, filtros.hasta)
        query = query.gte('emitido_at', desdeISO).lte('emitido_at', hastaISO)
    }

    if (filtros.busqueda?.trim()) {
        query = query.ilike('numero_formateado', `%${filtros.busqueda.trim()}%`)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return (data ?? []) as Ticket[]
}

export async function getTicketsCliente(clienteId: string): Promise<Ticket[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('tickets')
        .select('*, sorteo:sorteos(id, nombre, premio)')
        .eq('cliente_id', clienteId)
        .order('emitido_at', { ascending: false })

    if (error) throw new Error(error.message)
    return (data ?? []) as Ticket[]
}

export async function getEventosTicket(ticketId: string): Promise<TicketEvento[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('ticket_eventos')
        .select('*, usuario:profiles(id, full_name)')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)
    return (data ?? []) as TicketEvento[]
}

/**
 * Pagos del cliente que todavía no tienen boleto vigente.
 * Cubre el caso de que el agente cierre el modal de confirmación.
 */
export async function getPagosSinTicket(clienteId: string): Promise<Pago[]> {
    const supabase = await createClient()

    const { data: pagos, error } = await supabase
        .from('pagos')
        .select('id, cliente_id, monto, periodo, created_at, deuda_id')
        .eq('cliente_id', clienteId)
        .order('created_at', { ascending: false })
        .limit(50)

    if (error) throw new Error(error.message)
    if (!pagos?.length) return []

    const { data: conBoleto } = await supabase
        .from('tickets')
        .select('pago_id')
        .in('pago_id', pagos.map(p => p.id))
        .eq('estado', 'valido')

    const boletados = new Set((conBoleto ?? []).map(t => t.pago_id))
    return pagos.filter(p => !boletados.has(p.id)) as Pago[]
}

// ─── ENVÍO POR WHATSAPP ───────────────────────────────────────

/** Un teléfono sirve si tiene al menos 10 dígitos tras quitar el formato. */
export async function telefonoEsValido(telefono?: string | null): Promise<boolean> {
    if (!telefono) return false
    return telefono.replace(/\D/g, '').length >= 10
}

async function postWebhook(
    url: string,
    headers: Record<string, string>,
    payload: unknown,
): Promise<{ ok: boolean; status: number; body: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(payload),
            signal: controller.signal,
        })
        return { ok: resp.ok, status: resp.status, body: await resp.text() }
    } catch (e) {
        return {
            ok: false,
            status: 0,
            body: e instanceof DOMException && e.name === 'AbortError'
                ? 'Timeout: el webhook no respondió en 30 segundos'
                : String(e),
        }
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Construye el payload del webhook de boletos.
 * El PDF viaja en base64 dentro del cuerpo (modo por defecto) porque el
 * servidor no está expuesto a internet y el POST es saliente.
 */
async function construirPayloadTicket(
    ticket: Ticket,
    cfg: ConfiguracionTicket,
    plantillaContenido: string,
    reenvio: boolean,
): Promise<TicketWebhookPayload> {
    const s = ticket.snapshot
    const base = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000'
    const urlPublica = `${base}/t/${ticket.token_publico}`

    const mensaje = renderTemplate(plantillaContenido, {
        nombre: s.cliente.nombre,
        apellido: s.cliente.apellido,
        ticket_numero: ticket.numero_formateado,
        sorteo: s.sorteo?.nombre ?? 'nuestro sorteo',
        premio: s.sorteo?.premio ?? '',
        fecha: formatearFechaHoraRD(ticket.emitido_at),
        url_terminos: cfg.url_terminos ?? `${base}/terminos`,
    })

    const incluirBase64 = cfg.modo_adjunto === 'base64' || cfg.modo_adjunto === 'ambos'
    const incluirUrl = cfg.modo_adjunto === 'url' || cfg.modo_adjunto === 'ambos'

    let adjunto: TicketWebhookPayload['adjunto'] = null
    if (incluirBase64) {
        const pdf = await generarTicketPdf(ticket)
        adjunto = {
            tipo: 'pdf',
            nombre: `boleto-${ticket.numero_formateado}.pdf`,
            base64: pdf.toString('base64'),
        }
    }

    return {
        evento: 'ticket_emitido',
        timestamp: new Date().toISOString(),
        enviado_por: reenvio ? 'manual' : 'sistema',
        reenvio,
        cliente: {
            id: s.cliente.id,
            nombre: s.cliente.nombre,
            apellido: s.cliente.apellido,
            telefono: s.cliente.telefono ?? '',
        },
        ticket: {
            id: ticket.id,
            numero: ticket.numero_formateado,
            sorteo: s.sorteo?.nombre ?? null,
            emitido_at: ticket.emitido_at,
        },
        mensaje,
        url_terminos: cfg.url_terminos ?? null,
        url_publica: incluirUrl ? urlPublica : null,
        adjunto,
    }
}

export async function enviarTicketWhatsApp(
    ticketId: string,
    opciones?: { reenvio?: boolean },
): Promise<{ ok: boolean; estado: number }> {
    const { supabase, user } = await perfilActual()
    const reenvio = opciones?.reenvio ?? false

    const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .select('*')
        .eq('id', ticketId)
        .single()

    if (ticketError || !ticket) throw new Error('Boleto no encontrado')

    const t = ticket as Ticket

    if (t.estado === 'anulado') {
        await registrarFalloPrecondicionEnvio(t.id, 'El boleto está anulado', user.id, reenvio)
        throw new Error('El boleto está anulado')
    }

    if (!(await telefonoEsValido(t.snapshot.cliente.telefono))) {
        await registrarFalloPrecondicionEnvio(
            t.id, 'El cliente no tiene un teléfono válido registrado', user.id, reenvio,
        )
        throw new Error('El cliente no tiene un teléfono válido registrado')
    }

    const { data: cfg } = await supabase
        .from('configuracion_ticket').select('*').eq('id', true).single()
    if (!cfg) {
        await registrarFalloPrecondicionEnvio(t.id, 'Falta configurar el módulo de boletos', user.id, reenvio)
        throw new Error('Falta configurar el módulo de boletos')
    }

    const { data: plantilla } = await supabase
        .from('plantillas_mensaje')
        .select('*')
        .eq('etapa', 'ticket')
        .eq('activo', true)
        .maybeSingle()
    if (!plantilla) {
        await registrarFalloPrecondicionEnvio(t.id, 'No hay plantilla activa para boletos', user.id, reenvio)
        throw new Error('No hay plantilla activa para boletos')
    }

    // C1: se lee con el cliente admin porque la única policy de `webhooks`
    // es "admin acceso total" -- un agente ve 0 filas con el cliente de
    // sesión y esto fallaba el 100% de las veces para los 7 agentes. No se
    // añade una policy de lectura para agentes: `headers` puede llevar
    // credenciales del proveedor de WhatsApp, y no hay razón de negocio
    // para que un agente pueda leerlas. La comprobación de si el agente
    // puede enviar este boleto ya ocurrió arriba en TypeScript (permisos,
    // propiedad del cliente); esto es solo la lectura de configuración.
    const admin = crearClienteAdmin()
    const { data: webhook } = await admin
        .from('webhooks')
        .select('*')
        .eq('activo', true)
        .eq('evento', 'ticket')
        .maybeSingle()
    if (!webhook) {
        await registrarFalloPrecondicionEnvio(
            t.id, 'No hay webhook activo configurado para boletos', user.id, reenvio,
        )
        throw new Error('No hay webhook activo configurado para boletos')
    }

    const payload = await construirPayloadTicket(
        t, cfg as ConfiguracionTicket, plantilla.contenido, reenvio,
    )

    const resultado = await postWebhook(webhook.url, webhook.headers ?? {}, payload)

    // El base64 del PDF NO se guarda en el log: solo su tamaño.
    const { adjunto, ...payloadSinPdf } = payload
    await supabase.from('ticket_eventos').insert({
        ticket_id: t.id,
        tipo: 'enviado_wa',
        estado: resultado.ok ? 'ok' : 'error',
        es_copia: reenvio,
        detalle: reenvio ? 'Reenvío manual' : 'Envío automático',
        payload: {
            ...payloadSinPdf,
            adjunto: adjunto
                ? { tipo: adjunto.tipo, nombre: adjunto.nombre, bytes: adjunto.base64.length }
                : null,
        },
        respuesta_http: resultado.status || null,
        respuesta_body: resultado.body?.slice(0, 2000) ?? null,
        usuario_id: user.id,
    })

    if (resultado.ok) {
        // I7: RPC atómico en vez de leer-y-escribir con el cliente de sesión.
        // La única policy de UPDATE sobre tickets para agentes exige
        // generar_ticket_manual, mientras que este flujo se gatea con
        // ver_tickets: para un agente con ver_tickets y sin
        // generar_ticket_manual, el UPDATE anterior afectaba 0 filas sin que
        // nadie se enterara (no había .select()). El RPC es SECURITY DEFINER
        // y hace el incremento en una sola sentencia atómica.
        const { error: incrementoError } = await supabase.rpc('incrementar_envio_ticket', {
            p_ticket_id: t.id,
        })
        if (incrementoError) {
            console.error(
                `[TICKETS] No se pudo incrementar veces_enviado del boleto ${t.id}:`,
                incrementoError.message,
            )
        }
    }

    revalidatePath(`/clientes/${t.cliente_id}`)
    revalidatePath('/tickets')

    if (!resultado.ok) {
        throw new Error(`El webhook respondió ${resultado.status}: ${resultado.body?.slice(0, 200)}`)
    }

    return { ok: true, estado: resultado.status }
}

/**
 * Envía un boleto ficticio al webhook de boletos para averiguar
 * empíricamente qué acepta el proveedor de WhatsApp. No persiste nada.
 */
export async function enviarBoletoDePrueba(): Promise<{
    ok: boolean; estado: number; cuerpo: string
}> {
    const { supabase, permisos } = await perfilActual()
    if (!permisos.generar_ticket_manual) {
        throw new Error('No tienes permiso para enviar pruebas')
    }

    const { data: cfg } = await supabase
        .from('configuracion_ticket').select('*').eq('id', true).single()
    if (!cfg) throw new Error('Falta configurar el módulo de boletos')

    const { data: plantilla } = await supabase
        .from('plantillas_mensaje')
        .select('*').eq('etapa', 'ticket').eq('activo', true).maybeSingle()
    if (!plantilla) throw new Error('No hay plantilla activa para boletos')

    // C1: mismo motivo que en enviarTicketWhatsApp -- webhooks solo lo puede
    // leer el cliente admin.
    const admin = crearClienteAdmin()
    const { data: webhook } = await admin
        .from('webhooks')
        .select('*').eq('activo', true).eq('evento', 'ticket').maybeSingle()
    if (!webhook) throw new Error('No hay webhook activo configurado para boletos')

    const c = cfg as ConfiguracionTicket
    const ahora = new Date().toISOString()

    const ticketFicticio: Ticket = {
        id: '00000000-0000-0000-0000-000000000000',
        numero: 0,
        numero_formateado: `${c.prefijo_numeracion}-PRUEBA`,
        sorteo_id: null,
        cliente_id: '00000000-0000-0000-0000-000000000000',
        pago_id: null,
        deuda_id: null,
        origen: 'manual',
        motivo: 'Boleto de prueba',
        estado: 'valido',
        anulado_por: null,
        anulado_at: null,
        motivo_anulacion: null,
        token_publico: 'prueba',
        emitido_por: null,
        emitido_at: ahora,
        veces_enviado: 0,
        veces_impreso: 0,
        created_at: ahora,
        snapshot: {
            cliente: {
                id: '00000000-0000-0000-0000-000000000000',
                nombre: 'Cliente',
                apellido: 'de Prueba',
                telefono: null,
                dni_ruc: null,
            },
            sorteo: null,
            negocio: {
                nombre_comercial: c.nombre_comercial,
                rnc: c.rnc,
                direccion: c.direccion,
                telefono: c.telefono,
                texto_legal: c.texto_legal,
                url_terminos: c.url_terminos,
                pie_impresion: c.pie_impresion,
                logo_url: c.logo_url,
            },
            emitido_at_rd: formatearFechaHoraRD(ahora),
            origen: 'manual',
            version_snapshot: 1,
        },
    }

    const payload = await construirPayloadTicket(
        ticketFicticio, c, plantilla.contenido, false,
    )
    const resultado = await postWebhook(webhook.url, webhook.headers ?? {}, payload)

    return {
        ok: resultado.ok,
        estado: resultado.status,
        cuerpo: resultado.body?.slice(0, 1000) ?? '',
    }
}
