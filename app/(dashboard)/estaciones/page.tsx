import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSucursales, getEstaciones } from '@/lib/actions/estaciones'
import { EstacionesView } from '@/components/estaciones/estaciones-view'
import { PageHeader } from '@/components/layout/page-header'
import { Printer } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function EstacionesPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: perfil } = await supabase
        .from('profiles').select('rol').eq('id', user!.id).single()

    if (perfil?.rol !== 'admin') redirect('/dashboard')

    const [sucursales, estaciones] = await Promise.all([
        getSucursales(),
        getEstaciones(),
    ])

    return (
        <div className="space-y-6 p-4 sm:p-6">
            <PageHeader
                title="Estaciones de impresión"
                description="Sucursales e impresoras POS conectadas al sistema"
                icon={Printer}
            />
            <EstacionesView sucursales={sucursales} estaciones={estaciones} />
        </div>
    )
}
