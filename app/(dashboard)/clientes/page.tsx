import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/actions/usuarios'
import { ClientesTable } from '@/components/clientes/clientes-table'
import { Profile, Cliente } from '@/lib/types'
import { Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

export default async function ClientesPage() {
    const supabase = await createClient()
    const [profile, { data: clientes }, { data: agentes }] = await Promise.all([
        getCurrentUser(),
        supabase.from('clientes').select(`
      *,
      agente:profiles(id, full_name, rol),
      deudas(id, etapa, estado, saldo_pendiente, dias_atraso)
    `).order('created_at', { ascending: false }),
        supabase.from('profiles').select('id, full_name, rol, activo, created_at, updated_at').eq('activo', true),
    ])


    return (
        <div className="p-4 sm:p-6 space-y-6">
            <PageHeader title="Clientes" description="Gestión de clientes deudores" icon={Users} />
            <ClientesTable
                clientes={(clientes ?? []) as unknown as Cliente[]}
                agentes={(agentes ?? []) as Profile[]}
                currentProfile={profile}
            />
        </div>
    )
}
