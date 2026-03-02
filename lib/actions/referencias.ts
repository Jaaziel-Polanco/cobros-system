'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ReferenciaSchema, ReferenciaFormData } from '@/lib/validations/schemas'

export async function getReferencias(clienteId?: string) {
    const supabase = await createClient()
    let query = supabase
        .from('referencias_cliente')
        .select(`*, cliente:clientes(id, nombre, apellido)`)
        .order('created_at', { ascending: false })

    if (clienteId) query = query.eq('cliente_id', clienteId)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return data
}

export async function createReferencia(formData: ReferenciaFormData) {
    const supabase = await createClient()
    const validated = ReferenciaSchema.parse(formData)
    const { data, error } = await supabase
        .from('referencias_cliente')
        .insert({
            ...validated,
            relacion: validated.relacion || null,
            notas: validated.notas || null,
        })
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/referencias')
    revalidatePath(`/clientes/${validated.cliente_id}`)
    return data
}

export async function updateReferencia(id: string, formData: Partial<ReferenciaFormData>) {
    const supabase = await createClient()
    const validated = ReferenciaSchema.partial().parse(formData)

    const payload: Record<string, unknown> = { ...validated }
    if (validated.relacion !== undefined) payload.relacion = validated.relacion || null
    if (validated.notas !== undefined) payload.notas = validated.notas || null

    const { data, error } = await supabase
        .from('referencias_cliente')
        .update(payload)
        .eq('id', id)
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/referencias')
    return data
}

export async function deleteReferencia(id: string) {
    const supabase = await createClient()
    const { error } = await supabase.from('referencias_cliente').delete().eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/referencias')
}
