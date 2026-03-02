import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { getDeudasConPagosPendientes } from '@/lib/actions/deudas'

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) redirect('/login')

    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

    if (!profile) redirect('/login')

    let deudasPendientes: Awaited<ReturnType<typeof getDeudasConPagosPendientes>> = []
    try {
        deudasPendientes = await getDeudasConPagosPendientes()
    } catch {
        // Silently fail -- panel just won't show
    }

    return (
        <DashboardShell profile={profile} deudasPendientes={deudasPendientes}>
            {children}
        </DashboardShell>
    )
}
