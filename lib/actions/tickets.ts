'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getPermisos } from '@/lib/utils/permisos'
import {
    TicketManualSchema,
    AnularTicketSchema,
    type TicketManualFormData,
} from '@/lib/validations/tickets'
import type { Ticket, TicketEvento, Pago, Rol } from '@/lib/types'

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
