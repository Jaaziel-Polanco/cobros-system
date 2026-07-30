import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConfiguracionTicket } from '@/lib/actions/configuracion-ticket'
import { ConfiguracionTicketView } from '@/components/configuracion/configuracion-ticket-view'
import { PageHeader } from '@/components/layout/page-header'
import { Settings } from 'lucide-react'

export default async function ConfiguracionTicketsPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: perfil } = await supabase
        .from('profiles').select('id, rol').eq('id', user!.id).single()

    if (perfil?.rol !== 'admin') redirect('/dashboard')

    const configuracion = await getConfiguracionTicket()
    const urlPublicaBase = process.env.APP_PUBLIC_URL || 'http://localhost:3000'

    return (
        <div className="space-y-6 p-4 sm:p-6">
            <PageHeader
                title="Configuración de Boletos"
                description="Datos del negocio impresos en el boleto y modo de envío por WhatsApp"
                icon={Settings}
            />
            <ConfiguracionTicketView
                configuracion={configuracion}
                urlPublicaBase={urlPublicaBase}
            />
        </div>
    )
}
