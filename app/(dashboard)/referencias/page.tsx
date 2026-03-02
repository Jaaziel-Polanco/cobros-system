import { createClient } from '@/lib/supabase/server'
import { ReferenciasView } from '@/components/referencias/referencias-view'
import { ReferenciaCliente } from '@/lib/types'
import { BookUser } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

export default async function ReferenciasPage() {
    const supabase = await createClient()
    const [{ data: referencias }, { data: clientes }] = await Promise.all([
        supabase.from('referencias_cliente').select(`
      *,
      cliente:clientes(id, nombre, apellido)
    `).order('created_at', { ascending: false }),
        supabase.from('clientes').select('id, nombre, apellido').eq('activo', true).order('nombre'),
    ])

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <PageHeader title="Referencias" description="Contactos de referencia por cliente" icon={BookUser} />
            <ReferenciasView
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                referencias={(referencias ?? []) as any as (ReferenciaCliente & { cliente?: { id: string; nombre: string; apellido: string } | null })[]}
                clientes={clientes ?? []}
            />
        </div>
    )
}

