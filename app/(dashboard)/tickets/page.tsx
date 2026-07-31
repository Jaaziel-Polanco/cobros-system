import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos } from '@/lib/utils/permisos'
import { getTickets, type FiltrosTickets } from '@/lib/actions/tickets'
import { TicketsView } from '@/components/tickets/tickets-view'
import { PageHeader } from '@/components/layout/page-header'
import { Ticket } from 'lucide-react'

type ValorBusqueda = string | string[] | undefined

/** Toma el primer valor si `searchParams` trae un array (?x=1&x=2). */
function unoSolo(v: ValorBusqueda): string | undefined {
    return Array.isArray(v) ? v[0] : v
}

export default async function TicketsPage({
    searchParams,
}: {
    // Next.js 16: searchParams de un Server Component es una Promise.
    searchParams: Promise<Record<string, ValorBusqueda>>
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: perfil } = await supabase
        .from('profiles').select('id, rol, permisos').eq('id', user!.id).single()

    const permisos = getPermisos(perfil!)
    if (!permisos.ver_tickets) redirect('/dashboard')

    const sp = await searchParams
    const estado = unoSolo(sp.estado)
    const origen = unoSolo(sp.origen)

    // Los filtros viajan al servidor para que el WHERE se aplique en la base
    // (I9): antes, getTickets() se llamaba sin argumentos y el filtrado
    // ocurría solo sobre las 300 filas más recientes que traía el .limit(300)
    // del ORDER BY -- un boleto anulado antiguo, fuera de esas 300 filas,
    // era imposible de encontrar sin importar el filtro elegido en pantalla.
    const filtros: FiltrosTickets = {
        estado: estado === 'valido' || estado === 'anulado' ? estado : undefined,
        origen: origen === 'automatico' || origen === 'manual' ? origen : undefined,
        sorteoId: unoSolo(sp.sorteoId) || undefined,
        soloHuerfanos: unoSolo(sp.soloHuerfanos) === '1',
        desde: unoSolo(sp.desde) || undefined,
        hasta: unoSolo(sp.hasta) || undefined,
    }

    const tickets = await getTickets(filtros)
    // `estado` viaja para que la asignación masiva de huérfanos no ofrezca
    // sorteos cerrados: el RPC asignar_tickets_a_sorteo los rechaza siempre.
    const { data: sorteos } = await supabase
        .from('sorteos').select('id, nombre, estado').order('created_at', { ascending: false })

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
                filtrosIniciales={filtros}
            />
        </div>
    )
}
