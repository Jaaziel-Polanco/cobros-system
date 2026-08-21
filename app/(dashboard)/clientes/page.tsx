import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/actions/usuarios'
import { getClientes } from '@/lib/actions/clientes'
import { ClientesTable } from '@/components/clientes/clientes-table'
import { Profile, Cliente } from '@/lib/types'
import { Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

export default async function ClientesPage() {
    const supabase = await createClient()
    const [profile, clientes, { data: agentes }] = await Promise.all([
        getCurrentUser(),
        // PostgREST recorta en 1000 filas sin error ni cabecera, y aqui hay
        // 1455 clientes. La consulta que vivia en esta pagina dejaba 455
        // fuera de la pantalla -- siempre los mas antiguos, por ir ordenada
        // por created_at DESC, que son los de cartera mas vieja. getClientes()
        // ya paginaba y contrastaba contra el total exacto; lo unico que
        // faltaba era llamarla desde aqui.
        // incluirInactivos: la tabla tiene pestaña de inactivos y la llena ella.
        getClientes({ incluirInactivos: true }),
        supabase.from('profiles').select('id, full_name, rol, activo, created_at, updated_at').eq('activo', true),
    ])


    return (
        <div className="p-4 sm:p-6 space-y-6">
            <PageHeader title="Clientes" description="Gestión de clientes deudores" icon={Users} />
            <ClientesTable
                clientes={clientes as unknown as Cliente[]}
                agentes={(agentes ?? []) as Profile[]}
                currentProfile={profile}
            />
        </div>
    )
}
