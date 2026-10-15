import { redirect } from 'next/navigation'
import { getSesion } from '@/lib/supabase/sesion'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { getDeudasConPagosPendientes } from '@/lib/actions/deudas'
import { getEstadoEstacionDeUsuario } from '@/lib/actions/impresion'
import { getPermisos } from '@/lib/utils/permisos'

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    // Una sola lectura de usuario y perfil por petición, compartida con la
    // página y con las funciones de abajo (ver lib/supabase/sesion.ts).
    const sesion = await getSesion()
    if (!sesion) redirect('/login')

    const profile = sesion.perfil
    if (!profile) redirect('/login')

    // En paralelo: antes iban una detrás de otra.
    const [deudasPendientes, estacion] = await Promise.all([
        getDeudasConPagosPendientes().catch(() => {
            // Silently fail -- panel just won't show
            return [] as Awaited<ReturnType<typeof getDeudasConPagosPendientes>>
        }),
        // Sin el permiso, DashboardShell ni siquiera muestra el botón de
        // imprimir -- no tiene sentido pedir el estado de la estación.
        getPermisos(profile).imprimir_ticket
            ? getEstadoEstacionDeUsuario().catch(() => {
                // Silently fail -- el botón de imprimir queda como "sin sucursal"
                return null
            })
            : Promise.resolve(null),
    ])

    return (
        <DashboardShell profile={profile} deudasPendientes={deudasPendientes} estacion={estacion}>
            {children}
        </DashboardShell>
    )
}
