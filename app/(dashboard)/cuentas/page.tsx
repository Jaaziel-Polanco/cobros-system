import { createClient } from '@/lib/supabase/server'
import { CuentasView } from '@/components/cuentas/cuentas-view'
import { Deuda, Profile } from '@/lib/types'
import { CreditCard } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

export default async function CuentasPage() {
    const supabase = await createClient()
    const [{ data: deudas }, { data: clientes }, { data: agentes }] = await Promise.all([
        supabase.from('deudas').select(`
      *,
      cliente:clientes(id, nombre, apellido, telefono),
      agente:profiles(id, full_name, rol, activo, created_at, updated_at),
      configuracion:configuracion_recordatorio(*)
    `).order('created_at', { ascending: false }),
        supabase.from('clientes').select('id, nombre, apellido, telefono, dni_ruc').eq('activo', true).order('nombre'),
        supabase.from('profiles').select('id, full_name, rol, activo, created_at, updated_at').eq('activo', true),
    ])

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <PageHeader title="Cuentas" description="Gestión de deudas y seguimiento de cobranza" icon={CreditCard} />
            <CuentasView
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                deudas={(deudas ?? []) as any as Deuda[]}
                clientes={clientes ?? []}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                agentes={(agentes ?? []) as any as Profile[]}
            />
        </div>
    )
}

