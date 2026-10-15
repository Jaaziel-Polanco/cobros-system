import { cache } from 'react'
import { createClient } from './server'
import type { Profile } from '@/lib/types'

/**
 * Usuario y perfil de la sesión, leídos UNA vez por petición.
 *
 * El layout del dashboard, la página y las funciones que estos llaman
 * (pagos pendientes, estado de la estación…) pedían cada uno su
 * `auth.getUser()` —una llamada de red a Supabase Auth— y su fila de
 * `profiles`, en serie: en una carga completa de /cuentas eran 4 getUser y
 * 3 lecturas de perfil para el mismo usuario. `cache` de React las reduce a
 * una de cada dentro del mismo render o server action.
 *
 * Devuelve `null` sin sesión. `perfil` puede ser `null` si el usuario existe
 * en Auth pero no tiene fila en `profiles`.
 */
export const getSesion = cache(async () => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: perfil } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

    return { user, perfil: perfil as Profile | null }
})
