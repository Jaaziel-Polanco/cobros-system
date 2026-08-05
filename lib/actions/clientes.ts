'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ClienteSchema, ClienteFormData } from '@/lib/validations/schemas'
import {
    leerTodasLasFilas, encadenable, comoLote, comoConteo,
    type ConsultaEncadenable,
} from '@/lib/supabase/paginacion'

/**
 * Todos los clientes activos, para `/clientes`.
 *
 * PAGINADA. Este `select` estaba cortado por el tope de 1000 filas de
 * PostgREST: 1326 clientes activos en producción, de los que **326 no
 * aparecían en la lista**, sin error ni aviso de ninguna clase. Un cliente
 * que no aparece en la pantalla de clientes no se gestiona y no se cobra.
 *
 * Se pagina por `id` (único; `created_at` no lo es y no sirve de cursor). El
 * orden de pantalla —más reciente primero— se aplica abajo sobre la lista ya
 * completa, que es donde tiene sentido: ordenar cada lote por separado no
 * ordena el conjunto.
 */
export async function getClientes() {
    const supabase = await createClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type FilaCliente = { id: string; created_at: string } & Record<string, any>

    const filtrar = (consulta: ConsultaEncadenable) => consulta.eq('activo', true)

    const clientes = await leerTodasLasFilas<FilaCliente>({
        etiqueta: 'los clientes activos',
        clave: 'id',
        lote: (cursor, limite) => {
            const base = filtrar(encadenable(
                supabase.from('clientes').select(`
      *,
      agente:profiles(id, full_name, rol),
      deudas(id, etapa, estado, saldo_pendiente, fecha_corte, dias_atraso)
    `),
            ))
            return comoLote<FilaCliente>(
                (cursor ? base.gt('id', cursor) : base).order('id').limit(limite),
            )
        },
        contar: () => comoConteo(filtrar(
            encadenable(supabase.from('clientes').select('id', { count: 'exact', head: true })),
        )),
    })

    return clientes.sort((a, b) => {
        const ta = Date.parse(a.created_at), tb = Date.parse(b.created_at)
        if (ta !== tb) return tb - ta
        // Desempate estable por `id`, para que dos clientes creados en el
        // mismo instante no bailen de orden entre recargas.
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

export async function getClienteById(id: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('clientes')
        .select(`
      *,
      agente:profiles(id, full_name, rol),
      deudas(
        *,
        configuracion:configuracion_recordatorio(*)
      ),
      referencias_cliente(*)
    `)
        .eq('id', id)
        .single()

    if (error) throw new Error(error.message)
    return data
}

export async function createCliente(formData: ClienteFormData) {
    const supabase = await createClient()
    const validated = ClienteSchema.parse(formData)

    const payload = {
        ...validated,
        agente_id: validated.agente_id || null,
        dni_ruc: validated.dni_ruc || null,
        email: validated.email || null,
        direccion: validated.direccion || null,
        notas: validated.notas || null,
    }

    const { data, error } = await supabase
        .from('clientes')
        .insert(payload)
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/clientes')
    return data
}

export async function updateCliente(id: string, formData: ClienteFormData) {
    const supabase = await createClient()
    const validated = ClienteSchema.parse(formData)

    const payload = {
        ...validated,
        agente_id: validated.agente_id || null,
        dni_ruc: validated.dni_ruc || null,
        email: validated.email || null,
        direccion: validated.direccion || null,
        notas: validated.notas || null,
    }

    const { data, error } = await supabase
        .from('clientes')
        .update(payload)
        .eq('id', id)
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/clientes')
    revalidatePath(`/clientes/${id}`)
    return data
}

export async function deleteCliente(id: string) {
    const supabase = await createClient()

    // Verificar que el usuario actual es admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: profile } = await supabase
        .from('profiles')
        .select('rol')
        .eq('id', user.id)
        .single()

    if (profile?.rol !== 'admin') {
        throw new Error('Solo los administradores pueden eliminar clientes')
    }

    // Verificar si tiene deudas activas
    const { data: deudas } = await supabase
        .from('deudas')
        .select('id, saldo_pendiente, etapa')
        .eq('cliente_id', id)
        .eq('estado', 'activo')

    if (deudas && deudas.length > 0) {
        const totalSaldo = deudas.reduce((s, d) => s + Number(d.saldo_pendiente), 0)
        const fmt = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(totalSaldo)
        throw new Error(`CUENTAS_ACTIVAS:${deudas.length}:${fmt}`)
    }

    // Marcar como inactivo (soft delete)
    const { error } = await supabase
        .from('clientes')
        .update({ activo: false })
        .eq('id', id)

    if (error) throw new Error(error.message)
    revalidatePath('/clientes')
}

export async function getClientesSimple() {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('clientes')
        .select('id, nombre, apellido, telefono, dni_ruc')
        .eq('activo', true)
        .order('nombre')
    if (error) throw new Error(error.message)
    return data
}
