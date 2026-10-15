import { createClient } from '@/lib/supabase/server'
import { getClientesSimple } from '@/lib/actions/clientes'
import { getDeudas } from '@/lib/actions/deudas'
import { CuentasView } from '@/components/cuentas/cuentas-view'
import { Deuda, Profile } from '@/lib/types'
import { CreditCard } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { getPermisos } from '@/lib/utils/permisos'
import { getEstadoEstacionDeUsuario } from '@/lib/actions/impresion'

export default async function CuentasPage() {
    const supabase = await createClient()
    const [deudas, clientes, { data: agentes }] = await Promise.all([
        // Paginada: sin paginar, con más de 1000 deudas las más antiguas no
        // aparecían en esta pantalla.
        getDeudas(),
        // Sin paginar, este selector ofrecia 1000 de los 1455 clientes
        // activos: 455 no se podian elegir al crear una cuenta.
        getClientesSimple(),
        supabase.from('profiles').select('id, full_name, rol, activo, created_at, updated_at'),
    ])

    // I8: sin esto, el modal de boleto se abría tras registrar un pago sin
    // comprobar si el usuario puede usarlo -- solo podía fallar.
    const { data: { user } } = await supabase.auth.getUser()
    const { data: perfil } = await supabase
        .from('profiles')
        .select('id, rol, permisos')
        .eq('id', user!.id)
        .single()
    const puedeVerTickets = perfil ? getPermisos(perfil).ver_tickets : false
    const puedeImprimir = perfil ? getPermisos(perfil).imprimir_ticket : false
    const estacion = puedeImprimir ? await getEstadoEstacionDeUsuario() : null

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <PageHeader title="Cuentas" description="Gestión de deudas y seguimiento de cobranza" icon={CreditCard} />
            <CuentasView
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                deudas={(deudas ?? []) as any as Deuda[]}
                clientes={clientes}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                agentes={(agentes ?? []) as any as Profile[]}
                puedeVerTickets={puedeVerTickets}
                estacion={estacion}
                puedeImprimir={puedeImprimir}
            />
        </div>
    )
}

