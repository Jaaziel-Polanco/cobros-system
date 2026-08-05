'use server'

/**
 * Datos del panel de inicio.
 *
 * Vivían dentro de `app/(dashboard)/dashboard/page.tsx`. Se sacan aquí por
 * dos razones: un `page.tsx` no puede exportar nada más que el componente y
 * los metadatos, así que dentro de él estas funciones eran inalcanzables
 * para una prueba; y las dos lecturas alimentan **cifras**, que es donde un
 * truncamiento silencioso hace más daño.
 *
 * PostgREST corta en 1000 filas sin error ni cabecera (ver
 * `lib/supabase/paginacion.ts`). Las dos lecturas de `getDashboardData` iban
 * sin paginar:
 *
 *  - `deudas` activas (769 en producción) alimenta el `reduce` de la cartera
 *    total y los cuatro conteos por etapa. Una suma de dinero calculada
 *    sobre una lista recortada no es un número aproximado: es un número
 *    falso presentado en grande y en azul como si fuera bueno. Al pasar de
 *    1000 deudas la cartera quedaría subestimada sin ningún aviso.
 *  - `envios_log` del día alimenta "Enviados hoy" y el recuento de errores.
 *    Hoy hay pocos, pero el máximo histórico en un día es de 841: el margen
 *    hasta el tope es de un mal día.
 *
 * Las dos se paginan con `leerTodasLasFilas`, que ante la menor duda lanza
 * en vez de devolver una cifra corta. Para un panel, un error a la vista es
 * preferible a una cartera equivocada que nadie va a cuestionar.
 */

import { createClient } from '@/lib/supabase/server'
import {
    leerTodasLasFilas, encadenable, comoLote, comoConteo,
    type ConsultaEncadenable,
} from '@/lib/supabase/paginacion'

/**
 * "Hoy" en RD, como `YYYY-MM-DD`. Tal cual estaba en la página; no se toca
 * su semántica en este cambio.
 */
function hoyRD(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' })
}

interface FilaDeuda {
    id: string
    etapa: string
    estado: string
    saldo_pendiente: number
    monto_original: number
    pausado: boolean
}

interface FilaEnvio {
    id: string
    estado: string
}

export interface DatosDashboard {
    totalCartera: number
    activas: number
    byEtapa: {
        preventivo: number
        mora_temprana: number
        mora_alta: number
        recuperacion: number
    }
    enviados: number
    erroresHoy: number
    totalEnviosHoy: number
}

export async function getDashboardData(): Promise<DatosDashboard> {
    const supabase = await createClient()
    const desde = hoyRD()

    const filtrarDeudas = (consulta: ConsultaEncadenable) =>
        consulta.eq('estado', 'activo')

    const filtrarEnvios = (consulta: ConsultaEncadenable) =>
        consulta.gte('sent_at', desde)

    const [deudas, enviosHoy] = await Promise.all([
        leerTodasLasFilas<FilaDeuda>({
            etiqueta: 'las deudas activas del panel',
            clave: 'id',
            lote: (cursor, limite) => {
                const base = filtrarDeudas(encadenable(
                    supabase
                        .from('deudas')
                        .select('id, etapa, estado, saldo_pendiente, monto_original, pausado'),
                ))
                return comoLote<FilaDeuda>(
                    (cursor ? base.gt('id', cursor) : base).order('id').limit(limite),
                )
            },
            contar: () => comoConteo(filtrarDeudas(
                encadenable(supabase.from('deudas').select('id', { count: 'exact', head: true })),
            )),
        }),
        leerTodasLasFilas<FilaEnvio>({
            etiqueta: 'los envíos de hoy',
            clave: 'id',
            lote: (cursor, limite) => {
                const base = filtrarEnvios(encadenable(
                    supabase.from('envios_log').select('id, estado'),
                ))
                return comoLote<FilaEnvio>(
                    (cursor ? base.gt('id', cursor) : base).order('id').limit(limite),
                )
            },
            contar: () => comoConteo(filtrarEnvios(
                encadenable(supabase.from('envios_log').select('id', { count: 'exact', head: true })),
            )),
        }),
    ])

    // El filtro por `estado` ya lo hace la consulta; se conserva el de aquí
    // porque era el que había y no cuesta nada.
    const activas = deudas.filter(d => d.estado === 'activo')
    const totalCartera = activas.reduce((s, d) => s + Number(d.saldo_pendiente), 0)
    const byEtapa = {
        preventivo: activas.filter(d => d.etapa === 'preventivo').length,
        mora_temprana: activas.filter(d => d.etapa === 'mora_temprana').length,
        mora_alta: activas.filter(d => d.etapa === 'mora_alta').length,
        recuperacion: activas.filter(d => d.etapa === 'recuperacion').length,
    }

    const enviados = enviosHoy.filter(e => e.estado === 'enviado').length
    const erroresHoy = enviosHoy.filter(e => e.estado === 'error').length
    const totalEnviosHoy = enviosHoy.length

    return { totalCartera, activas: activas.length, byEtapa, enviados, erroresHoy, totalEnviosHoy }
}

/**
 * Los diez vencimientos más próximos. Sin paginar **a propósito**: el
 * `.limit(10)` es deliberado y la lista es de pantalla.
 */
export async function getProximosVencimientos() {
    const supabase = await createClient()
    const en7dias = new Date()
    en7dias.setDate(en7dias.getDate() + 7)

    const { data } = await supabase
        .from('deudas')
        .select('id, fecha_corte, saldo_pendiente, etapa, cliente:clientes(nombre, apellido, telefono)')
        .eq('estado', 'activo')
        .lte('fecha_corte', en7dias.toISOString().split('T')[0])
        .gte('fecha_corte', new Date().toISOString().split('T')[0])
        .order('fecha_corte')
        .limit(10)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []) as any[]
}
