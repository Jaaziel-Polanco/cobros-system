'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/lib/types'
import { toast } from 'sonner'
import {
    LayoutDashboard,
    Users,
    CreditCard,
    FileText,
    Webhook,
    UserCog,
    BookUser,
    ClipboardList,
    LogOut,
    ChevronLeft,
    ChevronRight,
    TrendingUp,
    X,
    FlaskConical,
    Store,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

// All nav items with optional permiso requirement
const ALL_NAV = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permiso: null },
    { href: '/clientes', label: 'Clientes', icon: Users, permiso: null },
    { href: '/cuentas', label: 'Cuentas', icon: CreditCard, permiso: null },
    { href: '/referencias', label: 'Referencias', icon: BookUser, permiso: 'ver_referencias' },
    { href: '/plantillas', label: 'Plantillas', icon: FileText, permiso: 'ver_plantillas' },
    { href: '/webhooks', label: 'Webhooks', icon: Webhook, permiso: 'ver_webhooks' },
    { href: '/tiendas-referidas', label: 'Tiendas (Referidos)', icon: Store, permiso: 'ver_tiendas_referidas' },
    { href: '/usuarios', label: 'Usuarios', icon: UserCog, permiso: 'admin_only' },
    { href: '/logs', label: 'Registros', icon: ClipboardList, permiso: 'ver_logs' },
    { href: '/simulador', label: 'Simulador', icon: FlaskConical, permiso: 'ver_simulador' },
]

interface AppSidebarProps {
    profile: Profile
    mobileOpen?: boolean
    onMobileClose?: () => void
}

export function AppSidebar({ profile, mobileOpen = false, onMobileClose }: AppSidebarProps) {
    const pathname = usePathname()
    const router = useRouter()
    const [collapsed, setCollapsed] = useState(false)
    const [loggingOut, setLoggingOut] = useState(false)

    const isAdmin = profile.rol === 'admin'
    const permisos = profile.permisos ?? {}

    const navItems = ALL_NAV.filter(item => {
        if (item.permiso === null) return true          // Always visible
        if (item.permiso === 'admin_only') return isAdmin
        if (isAdmin) return true
        return !!(permisos as Record<string, boolean>)[item.permiso]
    })

    const handleLogout = async () => {
        setLoggingOut(true)
        const supabase = createClient()
        await supabase.auth.signOut()
        toast.success('Sesión cerrada')
        router.push('/login')
        router.refresh()
    }

    const initials = profile.full_name
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()

    const sidebarContent = (
        <aside
            className={cn(
                'flex flex-col h-full transition-all duration-300 ease-in-out',
                // Desktop: collapsible width
                'lg:shrink-0',
                collapsed ? 'lg:w-16' : 'lg:w-64',
                // Mobile: full sidebar
                'w-72'
            )}
            style={{
                background: 'linear-gradient(180deg, #0a1628 0%, #0c1d38 50%, #091525 100%)',
                borderRight: '1px solid rgba(255,255,255,0.07)',
            }}
        >
            {/* Logo */}
            <div className={cn(
                'flex items-center border-b h-16',
                'border-white/7',
                collapsed ? 'lg:justify-center lg:px-2 px-4 gap-3' : 'px-4 gap-3'
            )}>
                <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shadow-[#007EC6]/30"
                    style={{ background: 'linear-gradient(135deg, #007EC6 0%, #0096E8 100%)' }}>
                    <TrendingUp className="w-5 h-5 text-white" />
                </div>
                {(!collapsed || mobileOpen) && (
                    <div className="overflow-hidden flex-1">
                        <p className="text-white font-bold text-sm leading-tight tracking-wide">Inversiones</p>
                        <p className="text-[10px] font-semibold leading-tight tracking-widest uppercase"
                            style={{ color: '#007EC6' }}>Cordero</p>
                    </div>
                )}
                {/* Mobile close */}
                {onMobileClose && (
                    <button onClick={onMobileClose} className="lg:hidden text-slate-400 hover:text-white ml-auto transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                )}
            </div>

            {/* Nav */}
            <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
                {navItems.map(item => {
                    const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            title={collapsed ? item.label : undefined}
                            onClick={onMobileClose}
                            className={cn(
                                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                                active
                                    ? 'text-white shadow-md'
                                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                            )}
                            style={active ? {
                                background: 'linear-gradient(135deg, #007EC6 0%, #0088d4 100%)',
                                boxShadow: '0 4px 12px rgba(0,126,198,0.3)',
                            } : undefined}
                        >
                            <item.icon className={cn('shrink-0', collapsed ? 'lg:w-5 lg:h-5 lg:mx-auto w-4 h-4' : 'w-4 h-4')} />
                            {(!collapsed || mobileOpen) && <span className="truncate">{item.label}</span>}
                            {active && (!collapsed || mobileOpen) && (
                                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white/70 pulse-dot" />
                            )}
                        </Link>
                    )
                })}
            </nav>

            {/* User + collapse */}
            <div className="border-t border-white/7 p-2 space-y-1">
                {(!collapsed || mobileOpen) && (
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5 mb-1">
                        <Avatar className="w-8 h-8 shrink-0">
                            <AvatarFallback className="text-white text-xs font-bold"
                                style={{ background: 'linear-gradient(135deg, #007EC6, #005f96)' }}>
                                {initials}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                            <p className="text-white text-xs font-semibold truncate">{profile.full_name}</p>
                            <Badge
                                variant="outline"
                                className={cn(
                                    'text-[10px] px-1.5 py-0 mt-0.5 border-0 font-medium',
                                    profile.rol === 'admin'
                                        ? 'bg-amber-500/20 text-amber-300'
                                        : 'bg-[#007EC6]/20 text-[#5bbfed]'
                                )}
                            >
                                {profile.rol === 'admin' ? '★ Admin' : 'Agente'}
                            </Badge>
                        </div>
                    </div>
                )}

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className={cn(
                        'w-full text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors',
                        collapsed ? 'lg:px-0 lg:justify-center justify-start gap-3' : 'justify-start gap-3'
                    )}
                >
                    <LogOut className="w-4 h-4 shrink-0" />
                    {(!collapsed || mobileOpen) && 'Cerrar sesión'}
                </Button>

                {/* Collapse toggle — desktop only */}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCollapsed(!collapsed)}
                    className="hidden lg:flex w-full text-slate-600 hover:text-slate-400 hover:bg-white/5 justify-center"
                >
                    {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </Button>
            </div>
        </aside>
    )

    return (
        <>
            {/* Desktop sidebar */}
            <div className="hidden lg:flex h-screen">
                {sidebarContent}
            </div>

            {/* Mobile sidebar overlay */}
            {mobileOpen && (
                <div className="lg:hidden fixed inset-0 z-50 flex">
                    <div className="sidebar-overlay absolute inset-0" onClick={onMobileClose} />
                    <div className="relative z-10 h-full">
                        {sidebarContent}
                    </div>
                </div>
            )}
        </>
    )
}
