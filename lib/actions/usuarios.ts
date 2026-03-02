'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
    UsuarioInviteFormData,
    UsuarioUpdateFormData,
    UsuarioCreateDirectoFormData,
} from '@/lib/validations/schemas'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
}

export async function getUsuarios() {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('profiles')
        .select('*')   // includes permisos once migration runs
        .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)
    return data
}

export async function inviteUsuario(formData: UsuarioInviteFormData) {
    const admin = getAdminClient()

    const { data, error } = await admin.auth.admin.inviteUserByEmail(formData.email, {
        data: {
            full_name: formData.full_name,
            rol: formData.rol,
        },
    })

    if (error) throw new Error(error.message)
    revalidatePath('/usuarios')
    return data
}

/**
 * Crea un usuario directamente con email + contraseña, ya confirmado.
 * Evita el rate limit de emails de Supabase.
 * Solo accesible por admins.
 */
export async function createUsuarioDirecto(formData: UsuarioCreateDirectoFormData) {
    const admin = getAdminClient()

    // Crear usuario con email ya confirmado
    const { data, error } = await admin.auth.admin.createUser({
        email: formData.email,
        password: formData.password,
        email_confirm: true,          // ← Confirmado sin email
        user_metadata: {
            full_name: formData.full_name,
            rol: formData.rol,
        },
    })

    if (error) {
        // Traducir errores comunes
        if (error.message.includes('already registered') || error.message.includes('already been registered')) {
            throw new Error('Ya existe un usuario con ese correo electrónico')
        }
        throw new Error(error.message)
    }

    // Supabase crea el perfil vía trigger, pero verificamos que exista
    // y actualizamos full_name/rol si el trigger no lo hizo aún
    if (data.user) {
        await admin
            .from('profiles')
            .upsert({
                id: data.user.id,
                full_name: formData.full_name,
                rol: formData.rol,
                activo: true,
            }, { onConflict: 'id' })
    }

    revalidatePath('/usuarios')
    return data
}

export async function updateUsuario(id: string, formData: UsuarioUpdateFormData) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: me } = await supabase.from('profiles').select('rol').eq('id', user.id).single()
    if (me?.rol !== 'admin') throw new Error('Solo administradores pueden modificar usuarios')

    const { error } = await supabase
        .from('profiles')
        .update({
            full_name: formData.full_name,
            rol: formData.rol,
            activo: formData.activo,
        })
        .eq('id', id)

    if (error) throw new Error(error.message)
    revalidatePath('/usuarios')
}

export async function updatePermisos(id: string, permisos: Record<string, boolean>) {
    const supabase = await createClient()

    // Solo admin puede cambiar permisos
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')
    const { data: me } = await supabase.from('profiles').select('rol').eq('id', user.id).single()
    if (me?.rol !== 'admin') throw new Error('Solo administradores pueden cambiar permisos')

    const { error } = await supabase
        .from('profiles')
        .update({ permisos })
        .eq('id', id)

    if (error) throw new Error(error.message)
    revalidatePath('/usuarios')
}

export async function deleteUsuario(id: string) {
    const admin = getAdminClient()
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) throw new Error(error.message)
    revalidatePath('/usuarios')
}

export async function asignarClientesAAgente(agenteId: string, clienteIds: string[]) {
    const supabase = await createClient()
    const { error } = await supabase
        .from('clientes')
        .update({ agente_id: agenteId })
        .in('id', clienteIds)

    if (error) throw new Error(error.message)
    revalidatePath('/clientes')
    revalidatePath('/usuarios')
}

export async function getCurrentUser() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

    return profile
}
