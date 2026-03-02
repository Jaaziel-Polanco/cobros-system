'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { DeudaSchema, DeudaFormData } from '@/lib/validations/schemas'
import { calcularDiasAtraso, getEtapaCobranza } from '@/lib/utils/cobranza-engine'
import { intentarEnvioInmediato } from '@/lib/actions/envios'

export async function getDeudas() {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('deudas')
        .select(`
      *,
      cliente:clientes(id, nombre, apellido, telefono, email),
      agente:profiles(id, full_name),
      configuracion:configuracion_recordatorio(*)
    `)
        .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)
    return data
}

export async function getDeudaById(id: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('deudas')
        .select(`
      *,
      cliente:clientes(*),
      agente:profiles(id, full_name),
      configuracion:configuracion_recordatorio(*)
    `)
        .eq('id', id)
        .single()

    if (error) throw new Error(error.message)
    return data
}

export async function createDeuda(formData: DeudaFormData) {
    const supabase = await createClient()
    const validated = DeudaSchema.parse(formData)

    const { configuracion, deuda } = splitDeudaConfig(validated)

    if (deuda.monto_original > 0 && deuda.saldo_pendiente > deuda.monto_original) {
        throw new Error('El saldo pendiente no puede ser mayor al monto original')
    }

    const diasAtraso = calcularDiasAtraso(deuda.fecha_corte)
    const etapa = getEtapaCobranza(diasAtraso)

    const { data: deudaData, error: deudaError } = await supabase
        .from('deudas')
        .insert({
            ...deuda,
            dias_atraso: diasAtraso,
            etapa,
        })
        .select()
        .single()

    if (deudaError) throw new Error(deudaError.message)

    const { error: configError } = await supabase
        .from('configuracion_recordatorio')
        .insert({ deuda_id: deudaData.id, ...configuracion })

    if (configError) throw new Error(configError.message)

    revalidatePath('/cuentas')
    revalidatePath(`/clientes/${deuda.cliente_id}`)

    intentarEnvioInmediato(deudaData.id).catch(() => {})

    return deudaData
}

export async function updateDeuda(id: string, formData: DeudaFormData) {
    const supabase = await createClient()
    const validated = DeudaSchema.parse(formData)

    const { configuracion, deuda } = splitDeudaConfig(validated)

    if (deuda.monto_original > 0 && deuda.saldo_pendiente > deuda.monto_original) {
        throw new Error('El saldo pendiente no puede ser mayor al monto original')
    }

    const diasAtraso = calcularDiasAtraso(deuda.fecha_corte)
    const etapa = getEtapaCobranza(diasAtraso)

    const { data, error } = await supabase
        .from('deudas')
        .update({ ...deuda, dias_atraso: diasAtraso, etapa })
        .eq('id', id)
        .select()
        .single()

    if (error) throw new Error(error.message)

    await supabase
        .from('configuracion_recordatorio')
        .upsert({ deuda_id: id, ...configuracion }, { onConflict: 'deuda_id' })

    revalidatePath('/cuentas')
    revalidatePath(`/clientes/${deuda.cliente_id}`)
    return data
}

export async function actualizarEstadoDeuda(
    id: string,
    estado: 'activo' | 'saldado' | 'cancelado' | 'refinanciado'
) {
    const supabase = await createClient()

    const updatePayload: Record<string, string> = { estado }
    if (estado === 'saldado') {
        updatePayload.etapa = 'saldado'
    }

    const { data, error } = await supabase
        .from('deudas')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/cuentas')
    return data
}

export async function togglePausaDeuda(id: string, pausado: boolean) {
    const supabase = await createClient()
    const { error } = await supabase
        .from('deudas')
        .update({ pausado })
        .eq('id', id)

    if (error) throw new Error(error.message)
    revalidatePath('/cuentas')
}

export async function registrarPago(id: string, montoPago: number) {
    const supabase = await createClient()

    const { data, error } = await supabase.rpc('registrar_pago_atomico', {
        p_deuda_id: id,
        p_monto_pago: montoPago,
    })

    if (error) throw new Error(error.message)
    if (!data?.ok) throw new Error(data?.error ?? 'Error al registrar pago')

    revalidatePath('/cuentas')
    revalidatePath('/dashboard')
    return data
}

export async function marcarPagoPeriodo(deudaId: string, periodo: string, nota?: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: deuda } = await supabase
        .from('deudas')
        .select('*, cliente:clientes(id)')
        .eq('id', deudaId)
        .single()

    if (!deuda) throw new Error('Deuda no encontrada')

    const montoPago = deuda.cuota_mensual ?? 0

    const { error: pagoError } = await supabase
        .from('pagos')
        .insert({
            deuda_id: deudaId,
            cliente_id: deuda.cliente_id,
            monto: montoPago,
            periodo,
            registrado_por: user?.id,
            nota: nota || null,
        })

    if (pagoError) throw new Error(pagoError.message)

    if (deuda.monto_original > 0 && montoPago > 0) {
        const result = await supabase.rpc('registrar_pago_atomico', {
            p_deuda_id: deudaId,
            p_monto_pago: montoPago,
        })
        if (result.error) throw new Error(result.error.message)
        if (!result.data?.ok) throw new Error(result.data?.error ?? 'Error al registrar pago')
    } else {
        const { data: deudaActual } = await supabase
            .from('deudas')
            .select('fecha_corte, frecuencia_pago')
            .eq('id', deudaId)
            .single()

        if (deudaActual) {
            let nuevaFecha: string
            const fc = new Date(deudaActual.fecha_corte + 'T00:00:00')
            if (deudaActual.frecuencia_pago === 'semanal') {
                fc.setDate(fc.getDate() + 7)
                nuevaFecha = fc.toISOString().split('T')[0]
            } else if (deudaActual.frecuencia_pago === 'quincenal') {
                fc.setDate(fc.getDate() + 15)
                nuevaFecha = fc.toISOString().split('T')[0]
            } else {
                fc.setMonth(fc.getMonth() + 1)
                nuevaFecha = fc.toISOString().split('T')[0]
            }

            await supabase
                .from('deudas')
                .update({
                    fecha_corte: nuevaFecha,
                    dias_atraso: 0,
                    etapa: 'preventivo',
                })
                .eq('id', deudaId)
        }
    }

    revalidatePath('/cuentas')
    revalidatePath('/dashboard')
}

export async function getPagosDeuda(deudaId: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('pagos')
        .select('*, registrador:profiles(id, full_name)')
        .eq('deuda_id', deudaId)
        .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)
    return data
}

export async function getDeudasConPagosPendientes() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data: deudas, error } = await supabase
        .from('deudas')
        .select(`
            *,
            cliente:clientes(id, nombre, apellido, telefono),
            agente:profiles(id, full_name),
            configuracion:configuracion_recordatorio(*)
        `)
        .eq('estado', 'activo')
        .eq('pausado', false)
        .neq('etapa', 'saldado')
        .eq('agente_id', user.id)
        .order('fecha_corte', { ascending: true })

    if (error) throw new Error(error.message)
    if (!deudas || deudas.length === 0) return []

    const deudaIds = deudas.map(d => d.id)
    const { data: pagosRecientes } = await supabase
        .from('pagos')
        .select('deuda_id, created_at, periodo')
        .in('deuda_id', deudaIds)
        .order('created_at', { ascending: false })

    const pagosMap = new Map<string, string>()
    pagosRecientes?.forEach(p => {
        if (!pagosMap.has(p.deuda_id)) {
            pagosMap.set(p.deuda_id, p.created_at)
        }
    })

    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)

    return deudas.filter(d => {
        const fc = new Date(d.fecha_corte + 'T00:00:00')
        const diasParaVencer = Math.floor((fc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
        const diasConfig = d.configuracion?.dias_antes_vencimiento ?? 3

        if (diasParaVencer > diasConfig) return false

        const ultimoPago = pagosMap.get(d.id)
        if (!ultimoPago) return true

        const fechaPago = new Date(ultimoPago)
        const diasDesdePago = Math.floor((hoy.getTime() - fechaPago.getTime()) / (1000 * 60 * 60 * 24))

        if (d.frecuencia_pago === 'semanal') return diasDesdePago >= 5
        if (d.frecuencia_pago === 'quincenal') return diasDesdePago >= 12
        return diasDesdePago >= 25
    }).map(d => ({
        ...d,
        ultimoPago: pagosMap.get(d.id) ?? null,
    }))
}

function splitDeudaConfig(validated: DeudaFormData) {
    const {
        dias_antes_vencimiento,
        frecuencia_mora_h,
        frecuencia_recuperacion_h,
        cuota_mensual,
        montos_activos,
        ...deudaFields
    } = validated

    const montoOriginal = montos_activos ? (deudaFields.monto_original ?? 0) : 0
    const saldoPendiente = montos_activos ? (deudaFields.saldo_pendiente ?? 0) : 0
    const tasaInteres = montos_activos ? (deudaFields.tasa_interes ?? 0) : 0

    return {
        configuracion: {
            dias_antes_vencimiento,
            frecuencia_mora_h,
            frecuencia_recuperacion_h,
        },
        deuda: {
            cliente_id: deudaFields.cliente_id,
            descripcion: deudaFields.descripcion || null,
            monto_original: montoOriginal,
            saldo_pendiente: saldoPendiente,
            cuota_mensual: montos_activos && cuota_mensual && cuota_mensual > 0 ? cuota_mensual : null,
            tasa_interes: tasaInteres,
            frecuencia_pago: deudaFields.frecuencia_pago,
            dia_corte_2: deudaFields.frecuencia_pago === 'quincenal' ? (deudaFields.dia_corte_2 ?? null) : null,
            fecha_corte: deudaFields.fecha_corte,
            es_deuda_existente: deudaFields.es_deuda_existente,
            fecha_deuda_origen: deudaFields.fecha_deuda_origen || null,
            agente_id: deudaFields.agente_id || null,
        },
    }
}
