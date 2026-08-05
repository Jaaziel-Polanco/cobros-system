'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
    ConfiguracionTicketSchema,
    type ConfiguracionTicketFormData,
} from '@/lib/validations/tickets'
import type { ConfiguracionTicket } from '@/lib/types'

export async function getConfiguracionTicket(): Promise<ConfiguracionTicket> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('configuracion_ticket')
        .select('*')
        .eq('id', true)
        .single()

    if (error) throw new Error(error.message)
    return data as ConfiguracionTicket
}

export async function actualizarConfiguracionTicket(
    input: ConfiguracionTicketFormData,
): Promise<void> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles').select('rol').eq('id', user.id).single()

    if (perfil?.rol !== 'admin') {
        throw new Error('Solo un administrador puede cambiar esta configuración')
    }

    const validado = ConfiguracionTicketSchema.parse(input)

    const { error } = await supabase
        .from('configuracion_ticket')
        .update({
            ...validado,
            logo_url: validado.logo_url || null,
            url_terminos: validado.url_terminos || null,
            updated_at: new Date().toISOString(),
            updated_by: user.id,
        })
        .eq('id', true)

    if (error) throw new Error(error.message)

    revalidatePath('/configuracion/tickets')
    revalidatePath('/tickets')
}
