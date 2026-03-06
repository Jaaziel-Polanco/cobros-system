'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { TiendaReferidaSchema, TiendaReferidaFormData } from '@/lib/validations/schemas'

export async function getTiendasReferidas(search?: string) {
    const supabase = await createClient()
    let query = supabase
        .from('tiendas_referidas')
        .select('*')
        .order('created_at', { ascending: false })

    if (search?.trim()) {
        query = query.or(`nombre.ilike.%${search.trim()}%,telefono.ilike.%${search.trim()}%`)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return data
}

export async function createTiendaReferida(formData: TiendaReferidaFormData) {
    const supabase = await createClient()
    const validated = TiendaReferidaSchema.parse(formData)
    const { data, error } = await supabase
        .from('tiendas_referidas')
        .insert({
            nombre: validated.nombre,
            telefono: validated.telefono,
            notas: validated.notas || null,
        })
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/tiendas-referidas')
    return data
}

export async function updateTiendaReferida(id: string, formData: Partial<TiendaReferidaFormData> & { activo?: boolean }) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('tiendas_referidas')
        .update(formData)
        .eq('id', id)
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/tiendas-referidas')
    return data
}

export async function deleteTiendaReferida(id: string) {
    const supabase = await createClient()
    const { error } = await supabase.from('tiendas_referidas').delete().eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/tiendas-referidas')
}

interface CsvRow { nombre: string; telefono: string }

export async function importarTiendasCsv(rows: CsvRow[]): Promise<{ total: number; insertados: number; errores: string[] }> {
    const supabase = await createClient()
    const errores: string[] = []
    const validos: { nombre: string; telefono: string }[] = []

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const nombre = row.nombre?.trim()
        const telefono = row.telefono?.trim()

        if (!nombre && !telefono) continue

        if (!nombre) {
            errores.push(`Fila ${i + 1}: nombre vacío`)
            continue
        }
        if (!telefono || telefono.length < 7) {
            errores.push(`Fila ${i + 1}: teléfono inválido "${telefono || ''}"`)
            continue
        }

        validos.push({ nombre, telefono })
    }

    if (validos.length > 0) {
        const { error } = await supabase.from('tiendas_referidas').insert(validos)
        if (error) throw new Error(`Error al insertar: ${error.message}`)
    }

    revalidatePath('/tiendas-referidas')
    return { total: rows.length, insertados: validos.length, errores }
}
