import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos } from '@/lib/utils/permisos'
import { getTickets } from '@/lib/actions/tickets'
import { TicketsView } from '@/components/tickets/tickets-view'
import { PageHeader } from '@/components/layout/page-header'
import { Ticket } from 'lucide-react'

export default async function TicketsPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: perfil } = await supabase
        .from('profiles').select('id, rol, permisos').eq('id', user!.id).single()

    const permisos = getPermisos(perfil!)
    if (!permisos.ver_tickets) redirect('/dashboard')

    const tickets = await getTickets()
    const { data: sorteos } = await supabase
        .from('sorteos').select('id, nombre').order('created_at', { ascending: false })

    return (
        <div className="space-y-6 p-4 sm:p-6">
            <PageHeader
                title="Boletos"
                description="Boletos de sorteo emitidos a los clientes"
                icon={Ticket}
            />
            <TicketsView
                tickets={tickets}
                sorteos={sorteos ?? []}
                puedeAnular={permisos.generar_ticket_manual}
                puedeAsignarSorteo={permisos.realizar_sorteo}
            />
        </div>
    )
}
