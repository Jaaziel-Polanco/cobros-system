'use server'

import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Sucursal, EstacionImpresion } from '@/lib/types'

/** SHA-256 en hexadecimal. El token plano nunca se guarda. */
export async function hashToken(token: string): Promise<string> {
    return crypto.createHash('sha256').update(token).digest('hex')
}

async function exigirAdmin() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles').select('rol').eq('id', user.id).single()

    if (perfil?.rol !== 'admin') {
        throw new Error('Solo un administrador puede gestionar sucursales y estaciones')
    }
    return supabase
}

// ─── SUCURSALES ───────────────────────────────────────────────

export async function getSucursales(): Promise<Sucursal[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('sucursales').select('*').order('nombre')
    if (error) throw new Error(error.message)
    return (data ?? []) as Sucursal[]
}

export async function crearSucursal(input: {
    nombre: string; direccion?: string; telefono?: string
}): Promise<Sucursal> {
    const supabase = await exigirAdmin()

    if (!input.nombre?.trim()) throw new Error('El nombre es obligatorio')

    const { data, error } = await supabase
        .from('sucursales')
        .insert({
            nombre: input.nombre.trim(),
            direccion: input.direccion?.trim() || null,
            telefono: input.telefono?.trim() || null,
        })
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/estaciones')
    return data as Sucursal
}

export async function actualizarSucursal(
    id: string,
    input: { nombre: string; direccion?: string; telefono?: string; activo: boolean },
): Promise<void> {
    const supabase = await exigirAdmin()

    const { error } = await supabase
        .from('sucursales')
        .update({
            nombre: input.nombre.trim(),
            direccion: input.direccion?.trim() || null,
            telefono: input.telefono?.trim() || null,
            activo: input.activo,
        })
        .eq('id', id)

    if (error) throw new Error(error.message)
    revalidatePath('/estaciones')
}

// ─── ESTACIONES ───────────────────────────────────────────────

export async function getEstaciones(): Promise<EstacionImpresion[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('estaciones_impresion')
        .select('id, sucursal_id, nombre, token_prefijo, impresora_ip, impresora_port, ancho_cols, codepage, activo, ultimo_heartbeat, ultima_ip_agente, version_agente, created_at, updated_at, sucursal:sucursales(id, nombre)')
        .order('nombre')

    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as EstacionImpresion[]
}

function generarToken(): string {
    return crypto.randomBytes(24).toString('base64url')
}

/**
 * Crea una estación y devuelve su token EN CLARO una sola vez.
 * En la base de datos solo queda el hash: si se pierde, hay que regenerarlo.
 */
export async function crearEstacion(input: {
    sucursal_id: string
    nombre: string
    impresora_ip: string
    impresora_port?: number
    ancho_cols?: number
    codepage?: string
}): Promise<{ estacion: EstacionImpresion; tokenPlano: string }> {
    const supabase = await exigirAdmin()

    if (!input.nombre?.trim()) throw new Error('El nombre es obligatorio')
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(input.impresora_ip)) {
        throw new Error('La IP de la impresora no es válida')
    }

    const tokenPlano = generarToken()

    const { data, error } = await supabase
        .from('estaciones_impresion')
        .insert({
            sucursal_id: input.sucursal_id,
            nombre: input.nombre.trim(),
            token_hash: await hashToken(tokenPlano),
            token_prefijo: tokenPlano.slice(0, 8),
            impresora_ip: input.impresora_ip,
            impresora_port: input.impresora_port ?? 9100,
            ancho_cols: input.ancho_cols ?? 48,
            codepage: input.codepage ?? 'cp850',
        })
        .select()
        .single()

    if (error) {
        if (error.code === '23505') {
            throw new Error('Esa sucursal ya tiene una estación activa')
        }
        throw new Error(error.message)
    }

    revalidatePath('/estaciones')
    return { estacion: data as EstacionImpresion, tokenPlano }
}

export async function actualizarEstacion(
    id: string,
    input: {
        nombre: string
        impresora_ip: string
        impresora_port: number
        ancho_cols: number
        codepage: string
        activo: boolean
    },
): Promise<void> {
    const supabase = await exigirAdmin()

    const { error } = await supabase
        .from('estaciones_impresion')
        .update({
            nombre: input.nombre.trim(),
            impresora_ip: input.impresora_ip,
            impresora_port: input.impresora_port,
            ancho_cols: input.ancho_cols,
            codepage: input.codepage,
            activo: input.activo,
        })
        .eq('id', id)

    if (error) {
        if (error.code === '23505') {
            throw new Error('Esa sucursal ya tiene una estación activa')
        }
        throw new Error(error.message)
    }
    revalidatePath('/estaciones')
}

export async function regenerarTokenEstacion(
    id: string,
): Promise<{ tokenPlano: string }> {
    const supabase = await exigirAdmin()
    const tokenPlano = generarToken()

    const { error } = await supabase
        .from('estaciones_impresion')
        .update({
            token_hash: await hashToken(tokenPlano),
            token_prefijo: tokenPlano.slice(0, 8),
        })
        .eq('id', id)

    if (error) throw new Error(error.message)
    revalidatePath('/estaciones')
    return { tokenPlano }
}

// ─── ASIGNACIÓN DE SUCURSAL A USUARIOS ────────────────────────

export async function asignarSucursalUsuario(
    userId: string,
    sucursalId: string | null,
): Promise<void> {
    const supabase = await exigirAdmin()

    const { error } = await supabase
        .from('profiles')
        .update({ sucursal_id: sucursalId })
        .eq('id', userId)

    if (error) throw new Error(error.message)
    revalidatePath('/usuarios')
    revalidatePath('/estaciones')
}
