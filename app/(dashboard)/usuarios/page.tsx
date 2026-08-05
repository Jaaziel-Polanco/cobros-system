import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { UsuariosView } from '@/components/usuarios/usuarios-view'
import { getCurrentUser } from '@/lib/actions/usuarios'
import { getSucursales } from '@/lib/actions/estaciones'
import { UserCog } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

export default async function UsuariosPage() {
    const profile = await getCurrentUser()
    if (profile?.rol !== 'admin') redirect('/dashboard')

    const supabase = await createClient()
    const [{ data: usuarios }, sucursales] = await Promise.all([
        supabase
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false }),
        getSucursales(),
    ])

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <PageHeader title="Usuarios" description="Gestión de agentes y administradores" icon={UserCog} />
            <UsuariosView usuarios={usuarios ?? []} sucursales={sucursales} />
        </div>
    )
}

