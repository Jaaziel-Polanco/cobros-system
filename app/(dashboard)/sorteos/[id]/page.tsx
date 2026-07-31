import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos } from '@/lib/utils/permisos'
import { getSorteoDetalle } from '@/lib/actions/sorteos'
import { SorteoDetalleView } from '@/components/sorteos/sorteo-detalle-view'

export const dynamic = 'force-dynamic'

export default async function SorteoDetallePage({
    params,
}: {
    // Next.js 16: params de un Server Component es una Promise.
    params: Promise<{ id: string }>
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: perfil } = await supabase
        .from('profiles').select('id, rol, permisos').eq('id', user!.id).single()

    const permisos = getPermisos(perfil!)
    if (!permisos.ver_sorteos) redirect('/dashboard')

    const { id } = await params

    let detalle: Awaited<ReturnType<typeof getSorteoDetalle>>
    try {
        detalle = await getSorteoDetalle(id)
    } catch {
        notFound()
    }

    return (
        <div className="space-y-6 p-4 sm:p-6">
            <SorteoDetalleView
                sorteo={detalle.sorteo}
                totalBoletos={detalle.totalBoletos}
                ejecucionVigente={detalle.ejecucionVigente}
                ganadores={detalle.ganadores}
                ejecuciones={detalle.ejecuciones}
                puedeGestionar={permisos.realizar_sorteo}
            />
        </div>
    )
}
