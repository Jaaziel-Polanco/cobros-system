'use client'

import { useState } from 'react'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { PagosPendientesPanel } from '@/components/layout/pagos-pendientes-panel'
import { Profile, Deuda } from '@/lib/types'
import { Menu, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ClienteSimple {
    id: string
    nombre: string
    apellido: string
    telefono: string
}

type DeudaPendiente = Deuda & {
    cliente?: ClienteSimple
    agente?: { full_name: string }
    ultimoPago: string | null
}

interface DashboardShellProps {
    profile: Profile
    children: React.ReactNode
    deudasPendientes?: DeudaPendiente[]
}

export function DashboardShell({ profile, children, deudasPendientes = [] }: DashboardShellProps) {
    const [mobileOpen, setMobileOpen] = useState(false)

    return (
        <div className="flex h-screen overflow-hidden" style={{ background: '#0a1628' }}>
            <AppSidebar
                profile={profile}
                mobileOpen={mobileOpen}
                onMobileClose={() => setMobileOpen(false)}
            />
            <main className="flex-1 flex flex-col overflow-hidden">
                {/* Mobile top bar */}
                <header className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-white/7 shrink-0"
                    style={{ background: '#0c1d38' }}>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-slate-400 hover:text-white h-8 w-8 p-0"
                        onClick={() => setMobileOpen(true)}
                    >
                        <Menu className="w-5 h-5" />
                    </Button>
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                            style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)' }}>
                            <TrendingUp className="w-3.5 h-3.5 text-white" />
                        </div>
                        <span className="text-white text-sm font-bold">Inversiones Cordero</span>
                    </div>
                </header>

                {/* Page content */}
                <div className="flex-1 overflow-auto relative" style={{ background: '#0d1f35' }}>
                    {children}

                    {/* Floating notification panel */}
                    {deudasPendientes.length > 0 && (
                        <PagosPendientesPanel deudasPendientes={deudasPendientes} />
                    )}
                </div>
            </main>
        </div>
    )
}
