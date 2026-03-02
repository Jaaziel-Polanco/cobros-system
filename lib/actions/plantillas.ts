'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { PlantillaSchema, PlantillaFormData } from '@/lib/validations/schemas'

export async function getPlantillas() {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('plantillas_mensaje')
        .select('*')
        .order('etapa')

    if (error) throw new Error(error.message)
    return data
}

export async function createPlantilla(formData: PlantillaFormData) {
    const supabase = await createClient()
    const validated = PlantillaSchema.parse(formData)
    const { data, error } = await supabase
        .from('plantillas_mensaje')
        .insert(validated)
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/plantillas')
    return data
}

export async function updatePlantilla(id: string, formData: PlantillaFormData) {
    const supabase = await createClient()
    const validated = PlantillaSchema.parse(formData)
    const { data, error } = await supabase
        .from('plantillas_mensaje')
        .update(validated)
        .eq('id', id)
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/plantillas')
    return data
}

export async function deletePlantilla(id: string) {
    const supabase = await createClient()
    const { error } = await supabase.from('plantillas_mensaje').delete().eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/plantillas')
}
