import { createClient } from '@/lib/supabase/server'
import { LogsView } from '@/components/logs/logs-view'
import { ClipboardList } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

export default async function LogsPage() {
    const supabase = await createClient()
    const { data: logs } = await supabase
        .from('envios_log')
        // Sólo lo que pinta LogsView: `*` traía también el `payload` (el JSON
        // entero enviado al webhook) de cada uno de los 200 envíos.
        .select(`
      id, etapa, enviado_por, estado, mensaje_enviado, respuesta_body,
      respuesta_http, sent_at, tipo_destino,
      cliente:clientes(id, nombre, apellido),
      agente:profiles(id, full_name)
    `)
        .order('sent_at', { ascending: false })
        .limit(200)

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <PageHeader title="Registros de Envío" description="Trazabilidad de todos los recordatorios enviados" icon={ClipboardList} />
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <LogsView logs={(logs ?? []) as any} />
        </div>
    )
}

