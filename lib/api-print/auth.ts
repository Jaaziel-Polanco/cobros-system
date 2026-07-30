import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export interface EstacionAutenticada {
    id: string
    sucursal_id: string
    nombre: string
    impresora_ip: string
    impresora_port: number
    ancho_cols: number
    codepage: string
    sucursal_nombre: string
}

/** Cliente con service-role. Solo vive en el servidor, nunca se expone. */
export function clienteAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )
}

/**
 * Resuelve el token de estación que envía el agente local.
 * Devuelve null si no corresponde a ninguna estación activa.
 *
 * El token se busca por su hash SHA-256, que es la clave de un índice único:
 * la comparación la hace el índice, no el código.
 */
export async function autenticarEstacion(
    token: unknown,
): Promise<EstacionAutenticada | null> {
    if (typeof token !== 'string' || token.length < 16) return null

    const hash = crypto.createHash('sha256').update(token).digest('hex')
    const supabase = clienteAdmin()

    const { data } = await supabase
        .from('estaciones_impresion')
        .select('id, sucursal_id, nombre, impresora_ip, impresora_port, ancho_cols, codepage, activo, sucursal:sucursales(nombre)')
        .eq('token_hash', hash)
        .maybeSingle()

    if (!data || !data.activo) return null

    return {
        id: data.id,
        sucursal_id: data.sucursal_id,
        nombre: data.nombre,
        impresora_ip: data.impresora_ip,
        impresora_port: data.impresora_port,
        ancho_cols: data.ancho_cols,
        codepage: data.codepage,
        sucursal_nombre:
            (data.sucursal as unknown as { nombre: string } | null)?.nombre ?? '',
    }
}

/** Registra el latido de la estación. Los fallos aquí no bloquean nada. */
export async function registrarLatido(
    estacionId: string,
    ip: string | null,
    version: string | null,
): Promise<void> {
    await clienteAdmin()
        .from('estaciones_impresion')
        .update({
            ultimo_heartbeat: new Date().toISOString(),
            ultima_ip_agente: ip,
            version_agente: version,
        })
        .eq('id', estacionId)
}
