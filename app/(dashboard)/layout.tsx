import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { getDeudasConPagosPendientes } from '@/lib/actions/deudas'
import { getEstadoEstacionDeUsuario } from '@/lib/actions/impresion'
import { getPermisos } from '@/lib/utils/permisos'

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) redirect('/login')

    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

    if (!profile) redirect('/login')

    let deudasPendientes: Awaited<ReturnType<typeof getDeudasConPagosPendientes>> = []
    try {
        deudasPendientes = await getDeudasConPagosPendientes()
    } catch {
        // Silently fail -- panel just won't show
    }

    let estacion: Awaited<ReturnType<typeof getEstadoEstacionDeUsuario>> = null
    // Sin el permiso, DashboardShell ni siquiera muestra el botón de
    // imprimir -- no tiene sentido pedir el estado de la estación.
    if (getPermisos(profile).imprimir_ticket) {
        try {
            estacion = await getEstadoEstacionDeUsuario()
        } catch {
            // Silently fail -- el botón de imprimir queda como "sin sucursal"
        }
    }

    return (
        <DashboardShell profile={profile} deudasPendientes={deudasPendientes} estacion={estacion}>
            {children}
        </DashboardShell>
    )
}
