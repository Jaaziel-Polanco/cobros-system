import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/usuarios'
import { TiendasReferidasView } from '@/components/tiendas/tiendas-referidas-view'
import { Store } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

export default async function TiendasReferidasPage() {
    const profile = await getCurrentUser()
    if (profile?.rol !== 'admin') redirect('/dashboard')

    const supabase = await createClient()
    const { data: tiendas } = await supabase
        .from('tiendas_referidas')
        .select('*')
        .order('created_at', { ascending: false })

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <PageHeader title="Tiendas (Referidos)" description="Registro de tiendas referidoras con acceso a la IA de referidos" icon={Store} />
            <TiendasReferidasView tiendas={tiendas ?? []} />
        </div>
    )
}
