'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { deleteCliente } from '@/lib/actions/clientes'
import { Cliente, Profile, EtapaCobranza } from '@/lib/types'
import { toast } from 'sonner'
import { ClienteForm } from './cliente-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
    Plus, Search, MoreHorizontal, Eye, Pencil, Trash2,
    AlertTriangle, ShieldOff, Users, UserX,
} from 'lucide-react'
import { formatMonto } from '@/lib/utils/template-renderer'
import { cn } from '@/lib/utils'

const ETAPA_CSS: Record<EtapaCobranza, string> = {
    preventivo: 'bg-green-500/20 text-green-300',
    mora_temprana: 'bg-yellow-500/20 text-yellow-300',
    mora_alta: 'bg-orange-500/20 text-orange-300',
    recuperacion: 'bg-red-500/20 text-red-300',
    saldado: 'bg-slate-500/20 text-slate-400',
}
const ETAPA_LABELS: Record<EtapaCobranza, string> = {
    preventivo: 'Preventivo',
    mora_temprana: 'Mora Temprana',
    mora_alta: 'Mora Alta',
    recuperacion: 'Recuperación',
    saldado: 'Saldado',
}

type ActivoFilter = 'activos' | 'inactivos' | 'todos'

interface ClientesTableProps {
    clientes: (Cliente & { deudas?: { etapa: string; estado: string; saldo_pendiente: number }[] })[]
    agentes: Profile[]
    currentProfile: Profile | null
}

type DeleteState =
    | null
    | { id: string; nombre: string; tipo: 'confirm' }
    | { id: string; nombre: string; tipo: 'warn_cuentas'; cuentas: number; saldo: string }

export function ClientesTable({ clientes, agentes, currentProfile }: ClientesTableProps) {
    const [search, setSearch] = useState('')
    const [etapaFilter, setEtapaFilter] = useState<string>('')
    const [activoFilter, setActivoFilter] = useState<ActivoFilter>('activos')
    const [formOpen, setFormOpen] = useState(false)
    const [editCliente, setEditCliente] = useState<Cliente | undefined>()
    const [deleteState, setDeleteState] = useState<DeleteState>(null)
    const [isPending, startTransition] = useTransition()

    const isAdmin = currentProfile?.rol === 'admin'

    // Counts for the toggle badges
    const totalActivos = clientes.filter(c => c.activo).length
    const totalInactivos = clientes.filter(c => !c.activo).length

    const filtered = clientes.filter(c => {
        // Activo filter
        if (activoFilter === 'activos' && !c.activo) return false
        if (activoFilter === 'inactivos' && c.activo) return false

        // Text search
        const term = search.toLowerCase()
        if (term && !`${c.nombre} ${c.apellido} ${c.telefono} ${c.dni_ruc ?? ''}`.toLowerCase().includes(term)) return false

        // Etapa filter
        if (etapaFilter) {
            const deudaActiva = c.deudas?.find(d => d.estado === 'activo')
            if (!deudaActiva || deudaActiva.etapa !== etapaFilter) return false
        }
        return true
    })

    const handleDeleteClick = (c: Cliente & { deudas?: { etapa: string; estado: string; saldo_pendiente: number }[] }) => {
        const deudas = c.deudas?.filter(d => d.estado === 'activo') ?? []
        const nombre = `${c.nombre} ${c.apellido}`
        if (deudas.length > 0) {
            const saldo = deudas.reduce((s, d) => s + Number(d.saldo_pendiente), 0)
            const saldoFmt = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(saldo)
            setDeleteState({ id: c.id, nombre, tipo: 'warn_cuentas', cuentas: deudas.length, saldo: saldoFmt })
        } else {
            setDeleteState({ id: c.id, nombre, tipo: 'confirm' })
        }
    }

    const handleDelete = () => {
        if (!deleteState) return
        const id = deleteState.id
        startTransition(async () => {
            try {
                await deleteCliente(id)
                toast.success('Cliente eliminado correctamente')
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : 'Error al eliminar'
                if (msg.startsWith('CUENTAS_ACTIVAS:')) {
                    const [, count, saldo] = msg.split(':')
                    toast.error(`No se puede eliminar: tiene ${count} cuenta(s) activa(s) por ${saldo}`)
                } else {
                    toast.error(msg)
                }
            }
            setDeleteState(null)
        })
    }

    return (
        <>
            {/* ── Toolbar ─────────────────────────────────────── */}
            <div className="space-y-3">
                {/* Row 1: activo toggle + Nuevo cliente */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    {/* Activo filter pills */}
                    <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        {([
                            { key: 'activos', label: 'Activos', count: totalActivos, color: 'emerald' },
                            { key: 'inactivos', label: 'Inactivos', count: totalInactivos, color: 'slate' },
                            { key: 'todos', label: 'Todos', count: clientes.length, color: 'blue' },
                        ] as const).map(({ key, label, count, color }) => {
                            const active = activoFilter === key
                            const colorMap = {
                                emerald: { on: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400' },
                                slate: { on: 'bg-slate-500/20 text-slate-300 border-slate-500/30', dot: 'bg-slate-400' },
                                blue: { on: 'bg-[#007EC6]/20 text-[#5bbfed] border-[#007EC6]/30', dot: 'bg-[#007EC6]' },
                            }
                            return (
                                <button
                                    key={key}
                                    onClick={() => setActivoFilter(key)}
                                    className={cn(
                                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 border',
                                        active
                                            ? colorMap[color].on
                                            : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-white/5'
                                    )}
                                >
                                    {active && <span className={cn('w-1.5 h-1.5 rounded-full', colorMap[color].dot)} />}
                                    {label}
                                    <span className={cn(
                                        'ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold',
                                        active ? 'bg-white/15' : 'bg-white/5 text-slate-600'
                                    )}>
                                        {count}
                                    </span>
                                </button>
                            )
                        })}
                    </div>

                    <div className="flex-1" />

                    <Button
                        onClick={() => { setEditCliente(undefined); setFormOpen(true) }}
                        className="text-white gap-2 shrink-0"
                        style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)', boxShadow: '0 4px 12px rgba(0,126,198,0.25)' }}
                    >
                        <Plus className="w-4 h-4" />
                        Nuevo Cliente
                    </Button>
                </div>

                {/* Row 2: search + etapa */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <Input
                            placeholder="Buscar por nombre, teléfono, cédula..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="pl-9 bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
                        />
                    </div>
                    <Select onValueChange={v => setEtapaFilter(v === 'todos' ? '' : v)}>
                        <SelectTrigger className="w-44 bg-slate-800 border-white/10 text-white">
                            <SelectValue placeholder="Todas las etapas" />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-white/10 text-white">
                            <SelectItem value="todos">Todas las etapas</SelectItem>
                            <SelectItem value="preventivo">Preventivo</SelectItem>
                            <SelectItem value="mora_temprana">Mora Temprana</SelectItem>
                            <SelectItem value="mora_alta">Mora Alta</SelectItem>
                            <SelectItem value="recuperacion">Recuperación</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* ── Inactive banner ──────────────────────────────── */}
            {activoFilter === 'inactivos' && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs"
                    style={{ background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.12)' }}>
                    <UserX className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-400">Mostrando clientes inactivos — fueron eliminados o desactivados.</span>
                    {isAdmin && <span className="text-slate-500">Solo admins pueden restaurarlos editándolos.</span>}
                </div>
            )}

            {/* ── Table ────────────────────────────────────────── */}
            <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/5 text-slate-500 text-xs">
                                <th className="text-left p-4 font-medium">Cliente</th>
                                <th className="text-left p-4 font-medium">Teléfono</th>
                                <th className="text-left p-4 font-medium hidden sm:table-cell">Cédula/RNC</th>
                                <th className="text-left p-4 font-medium">Etapa</th>
                                <th className="text-left p-4 font-medium">Saldo</th>
                                <th className="text-left p-4 font-medium hidden md:table-cell">Agente</th>
                                <th className="text-center p-4 font-medium">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="text-center p-12">
                                        <div className="flex flex-col items-center gap-2 text-slate-500">
                                            <Users className="w-8 h-8 opacity-30" />
                                            <p>
                                                {activoFilter === 'inactivos'
                                                    ? 'No hay clientes inactivos'
                                                    : 'No se encontraron clientes'}
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filtered.map(c => {
                                const deudaActiva = c.deudas?.find(d => d.estado === 'activo')
                                const etapa = (deudaActiva?.etapa ?? 'preventivo') as EtapaCobranza
                                const saldo = c.deudas?.filter(d => d.estado === 'activo').reduce((s, d) => s + Number(d.saldo_pendiente), 0) ?? 0
                                return (
                                    <tr
                                        key={c.id}
                                        className={cn(
                                            'text-slate-300 hover:bg-white/3 transition-colors',
                                            !c.activo && 'opacity-50'
                                        )}
                                    >
                                        <td className="p-4">
                                            <div className="flex items-center gap-2">
                                                <div>
                                                    <div className="font-semibold text-white flex items-center gap-1.5">
                                                        {c.nombre} {c.apellido}
                                                        {!c.activo && (
                                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400 font-medium">
                                                                Inactivo
                                                            </span>
                                                        )}
                                                    </div>
                                                    {c.email && <div className="text-xs text-slate-500 mt-0.5">{c.email}</div>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">{c.telefono}</td>
                                        <td className="p-4 hidden sm:table-cell">{c.dni_ruc ?? '—'}</td>
                                        <td className="p-4">
                                            {deudaActiva ? (
                                                <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', ETAPA_CSS[etapa])}>
                                                    {ETAPA_LABELS[etapa]}
                                                </span>
                                            ) : (
                                                <span className="text-slate-600 text-xs">Sin deuda</span>
                                            )}
                                        </td>
                                        <td className="p-4 font-semibold text-white">
                                            {saldo > 0 ? formatMonto(saldo) : '—'}
                                        </td>
                                        <td className="p-4 hidden md:table-cell">
                                            {(c as { agente?: { full_name: string } }).agente?.full_name ?? <span className="text-slate-600">—</span>}
                                        </td>
                                        <td className="p-4 text-center">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-white/10">
                                                        <MoreHorizontal className="w-4 h-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end"
                                                    style={{ background: '#0c1d38', border: '1px solid rgba(0,126,198,0.15)' }}
                                                    className="text-slate-200">
                                                    <DropdownMenuItem asChild>
                                                        <Link href={`/clientes/${c.id}`} className="flex items-center gap-2 cursor-pointer">
                                                            <Eye className="w-4 h-4" /> Ver detalle
                                                        </Link>
                                                    </DropdownMenuItem>
                                                    {c.activo && (
                                                        <DropdownMenuItem
                                                            className="flex items-center gap-2 cursor-pointer"
                                                            onClick={() => { setEditCliente(c); setFormOpen(true) }}
                                                        >
                                                            <Pencil className="w-4 h-4" /> Editar
                                                        </DropdownMenuItem>
                                                    )}

                                                    {/* Delete — solo admin, solo si está activo */}
                                                    {c.activo && (
                                                        <>
                                                            <DropdownMenuSeparator className="bg-white/5" />
                                                            {isAdmin ? (
                                                                <DropdownMenuItem
                                                                    className="flex items-center gap-2 cursor-pointer text-red-400 focus:text-red-400 focus:bg-red-500/10"
                                                                    onClick={() => handleDeleteClick(c)}
                                                                >
                                                                    <Trash2 className="w-4 h-4" /> Eliminar
                                                                </DropdownMenuItem>
                                                            ) : (
                                                                <DropdownMenuItem disabled className="flex items-center gap-2 text-slate-600 cursor-not-allowed">
                                                                    <ShieldOff className="w-4 h-4" /> Solo admins
                                                                </DropdownMenuItem>
                                                            )}
                                                        </>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between text-xs text-slate-500">
                    <span>{filtered.length} cliente{filtered.length !== 1 ? 's' : ''} mostrado{filtered.length !== 1 ? 's' : ''}</span>
                    <span className="flex items-center gap-3">
                        <span className="text-emerald-500/70">{totalActivos} activos</span>
                        {totalInactivos > 0 && <span className="text-slate-600">{totalInactivos} inactivos</span>}
                    </span>
                </div>
            </div>

            {/* ── Modals ──────────────────────────────────────── */}
            <ClienteForm
                open={formOpen}
                onClose={() => { setFormOpen(false); setEditCliente(undefined) }}
                cliente={editCliente}
                agentes={agentes}
            />

            {/* Warn: has active accounts */}
            <AlertDialog
                open={deleteState?.tipo === 'warn_cuentas'}
                onOpenChange={v => { if (!v) setDeleteState(null) }}
            >
                <AlertDialogContent style={{ background: '#0c1d38', border: '1px solid rgba(239,68,68,0.25)', color: 'white' }}>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-white flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-amber-400" />
                            Este cliente tiene cuentas activas
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400 space-y-2">
                            <p>
                                <strong className="text-white">{deleteState?.tipo === 'warn_cuentas' ? deleteState.nombre : ''}</strong>{' '}
                                tiene{' '}
                                <strong className="text-amber-300">{deleteState?.tipo === 'warn_cuentas' ? deleteState.cuentas : ''} cuenta(s) activa(s)</strong>{' '}
                                con un saldo pendiente de{' '}
                                <strong className="text-red-300">{deleteState?.tipo === 'warn_cuentas' ? deleteState.saldo : ''}</strong>.
                            </p>
                            <p>Se recomienda <strong className="text-white">saldar o cancelar las cuentas primero</strong> antes de eliminar el cliente.</p>
                            <p className="text-xs text-slate-500 pt-1">Si continúas, el cliente quedará inactivo y visible solo con el filtro &quot;Inactivos&quot;.</p>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-white/10 text-slate-300 hover:bg-white/5">Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isPending}
                            className="bg-red-700 hover:bg-red-600 text-white"
                            onClick={handleDelete}
                        >
                            Eliminar de todas formas
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Normal confirm delete */}
            <AlertDialog
                open={deleteState?.tipo === 'confirm'}
                onOpenChange={v => { if (!v) setDeleteState(null) }}
            >
                <AlertDialogContent style={{ background: '#0c1d38', border: '1px solid rgba(239,68,68,0.2)', color: 'white' }}>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-white">¿Eliminar cliente?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">
                            <strong className="text-white">{deleteState?.tipo === 'confirm' ? deleteState.nombre : ''}</strong>{' '}
                            será marcado como inactivo. Puedes volver a verlo con el filtro <em>&quot;Inactivos&quot;</em>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-white/10 text-slate-300 hover:bg-white/5">Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isPending}
                            className="bg-red-600 hover:bg-red-500 text-white"
                            onClick={handleDelete}
                        >
                            Eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
