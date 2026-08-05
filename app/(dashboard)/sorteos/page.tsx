import { redirect } from 'next/navigation'
import { Gift } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisos } from '@/lib/utils/permisos'
import { getSorteos } from '@/lib/actions/sorteos'
import { SorteosView } from '@/components/sorteos/sorteos-view'
import { PageHeader } from '@/components/layout/page-header'

export const dynamic = 'force-dynamic'

export default async function SorteosPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: perfil } = await supabase
        .from('profiles').select('id, rol, permisos').eq('id', user!.id).single()

    const permisos = getPermisos(perfil!)
    if (!permisos.ver_sorteos) redirect('/dashboard')

    const sorteos = await getSorteos()

    return (
        <div className="space-y-6 p-4 sm:p-6">
            <PageHeader
                title="Sorteos"
                description="Campañas de sorteo y selección de ganadores"
                icon={Gift}
            />
            {/* puedeGestionar = realizar_sorteo: es el mismo permiso que exigen
                las Server Actions de escritura (crearSorteo, activarSorteo,
                cerrarSorteo, ejecutarSorteo, marcarPremioEntregado) y la policy
                "sorteos: escritura con permiso". */}
            <SorteosView sorteos={sorteos} puedeGestionar={permisos.realizar_sorteo} />
        </div>
    )
}
