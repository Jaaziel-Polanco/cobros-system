'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
    UsuarioInviteSchema, UsuarioInviteFormData,
    UsuarioCreateDirectoSchema, UsuarioCreateDirectoFormData,
} from '@/lib/validations/schemas'
import { inviteUsuario, updateUsuario, deleteUsuario, updatePermisos, createUsuarioDirecto } from '@/lib/actions/usuarios'
import { Profile, PermisosAgente, DEFAULT_PERMISOS_AGENTE } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
    Plus, Trash2, Loader2, ShieldCheck, UserCheck, UserX, Mail,
    Settings2, ChevronDown, ChevronUp, Eye, EyeOff, Webhook, FileText,
    BookUser, FlaskConical, Pencil, Ban, UserPlus, Send, CheckCircle2,
    Lock, DollarSign, CreditCard,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface UsuariosViewProps { usuarios: Profile[] }

// ── Permisos config ─────────────────────────────────────────────
interface PermisoConfig {
    key: keyof PermisosAgente
    label: string
    desc: string
    icon: React.ElementType
    colorOn: string
}

const PERMISOS_CONFIG: PermisoConfig[] = [
    { key: 'ver_webhooks', label: 'Webhooks', desc: 'Ver y gestionar webhooks', icon: Webhook, colorOn: '#5bbfed' },
    { key: 'ver_plantillas', label: 'Plantillas', desc: 'Ver y editar plantillas de mensajes', icon: FileText, colorOn: '#a78bfa' },
    { key: 'ver_logs', label: 'Registros', desc: 'Ver historial de envíos', icon: Eye, colorOn: '#6ee7b7' },
    { key: 'ver_referencias', label: 'Referencias', desc: 'Gestionar referencias de clientes', icon: BookUser, colorOn: '#fcd34d' },
    { key: 'ver_simulador', label: 'Simulador', desc: 'Usar el simulador de envíos', icon: FlaskConical, colorOn: '#f87171' },
    { key: 'ver_tiendas_referidas', label: 'Tiendas Referidas', desc: 'Ver y gestionar tiendas referidoras', icon: CreditCard, colorOn: '#818cf8' },
    { key: 'editar_clientes', label: 'Editar Clientes', desc: 'Crear y editar clientes', icon: Pencil, colorOn: '#6ee7b7' },
    { key: 'crear_cuentas', label: 'Crear Cuentas', desc: 'Registrar nuevas cuentas/deudas', icon: CreditCard, colorOn: '#38bdf8' },
    { key: 'registrar_pagos', label: 'Registrar Pagos', desc: 'Registrar pagos de clientes', icon: DollarSign, colorOn: '#34d399' },
    { key: 'eliminar_cuentas', label: 'Cancelar Cuentas', desc: 'Cancelar o saldar cuentas', icon: Ban, colorOn: '#fca5a5' },
]

function getPermisos(u: Profile): PermisosAgente {
    return { ...DEFAULT_PERMISOS_AGENTE, ...(u.permisos ?? {}) }
}

export function UsuariosView({ usuarios }: UsuariosViewProps) {
    const [dialogOpen, setDialogOpen] = useState(false)
    const [dialogTab, setDialogTab] = useState<'invitar' | 'directo'>('invitar')
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [expandedPermisos, setExpandedPermisos] = useState<string | null>(null)
    const [showPwd, setShowPwd] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [isPending, startTransition] = useTransition()

    // ── Form: Invitar ──────────────────────────────────────────
    const inviteForm = useForm<UsuarioInviteFormData>({
        resolver: zodResolver(UsuarioInviteSchema),
        defaultValues: { rol: 'agente' },
    })

    // ── Form: Crear directo ────────────────────────────────────
    const directoForm = useForm<UsuarioCreateDirectoFormData>({
        resolver: zodResolver(UsuarioCreateDirectoSchema),
        defaultValues: { rol: 'agente' },
    })
    const pwdValue = directoForm.watch('password') ?? ''
    const confirmVal = directoForm.watch('confirm') ?? ''
    const validations = {
        minLen: pwdValue.length >= 8,
        hasUpper: /[A-Z]/.test(pwdValue),
        hasNum: /[0-9]/.test(pwdValue),
        matches: pwdValue === confirmVal && confirmVal.length > 0,
    }

    const closeDialog = () => {
        setDialogOpen(false)
        inviteForm.reset()
        directoForm.reset()
        setShowPwd(false)
        setShowConfirm(false)
    }

    // ── Handlers ───────────────────────────────────────────────
    const handleInvite = (data: UsuarioInviteFormData) => {
        startTransition(async () => {
            try {
                await inviteUsuario(data)
                toast.success(`Invitación enviada a ${data.email}`)
                closeDialog()
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    const handleCrearDirecto = (data: UsuarioCreateDirectoFormData) => {
        startTransition(async () => {
            try {
                await createUsuarioDirecto(data)
                toast.success(`Usuario "${data.full_name}" creado correctamente`)
                closeDialog()
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    const handleToggleActivo = (usuario: Profile) => {
        startTransition(async () => {
            try {
                await updateUsuario(usuario.id, { full_name: usuario.full_name, rol: usuario.rol, activo: !usuario.activo })
                toast.success(usuario.activo ? 'Usuario desactivado' : 'Usuario activado')
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    const handleDelete = () => {
        if (!deleteId) return
        startTransition(async () => {
            try { await deleteUsuario(deleteId); toast.success('Usuario eliminado') }
            catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
            setDeleteId(null)
        })
    }

    const handleTogglePermiso = (usuario: Profile, key: keyof PermisosAgente, current: boolean) => {
        const permisos = getPermisos(usuario)
        const nuevosPermisos = { ...permisos, [key]: !current }
        startTransition(async () => {
            try {
                await updatePermisos(usuario.id, nuevosPermisos)
                const label = PERMISOS_CONFIG.find(p => p.key === key)?.label ?? key
                toast.success(`Permiso "${label}" ${!current ? 'activado' : 'desactivado'}`)
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    const activeCount = usuarios.filter(u => u.activo).length
    const inactiveCount = usuarios.filter(u => !u.activo).length

    return (
        <>
            {/* ── Header row ──────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
                        <span className="text-emerald-300 text-xs font-semibold">{activeCount} activos</span>
                    </div>
                    {inactiveCount > 0 && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-500/10 border border-slate-500/20">
                            <div className="w-2 h-2 rounded-full bg-slate-500" />
                            <span className="text-slate-400 text-xs font-semibold">{inactiveCount} inactivos</span>
                        </div>
                    )}
                </div>
                <Button
                    onClick={() => setDialogOpen(true)}
                    className="text-white font-semibold gap-2 shrink-0"
                    style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)', boxShadow: '0 4px 12px rgba(0,126,198,0.3)' }}
                >
                    <Plus className="w-4 h-4" />Agregar Usuario
                </Button>
            </div>

            {/* ── Users grid ──────────────────────────────────── */}
            <div className="grid gap-3">
                {usuarios.length === 0 ? (
                    <div className="text-center py-16 text-slate-500 rounded-2xl border border-white/5"
                        style={{ background: 'rgba(255,255,255,0.02)' }}>
                        No hay usuarios registrados
                    </div>
                ) : usuarios.map(u => {
                    const initials = u.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
                    const isAdmin = u.rol === 'admin'
                    const permisos = getPermisos(u)
                    const isExpanded = expandedPermisos === u.id

                    return (
                        <div
                            key={u.id}
                            className={cn('rounded-2xl transition-all duration-200', !u.activo && 'opacity-55')}
                            style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: u.activo ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(255,255,255,0.04)',
                            }}
                        >
                            {/* User row */}
                            <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                                <Avatar className="w-12 h-12 shrink-0">
                                    <AvatarFallback className="text-sm font-bold text-white"
                                        style={{
                                            background: isAdmin
                                                ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                                : 'linear-gradient(135deg, #007EC6, #005f96)',
                                        }}>
                                        {initials}
                                    </AvatarFallback>
                                </Avatar>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-semibold text-white text-sm">{u.full_name}</p>
                                        <Badge className={cn(
                                            'text-xs border-0 font-semibold px-2',
                                            isAdmin ? 'bg-amber-500/20 text-amber-300' : 'bg-[#007EC6]/20 text-[#5bbfed]'
                                        )}>
                                            {isAdmin ? <><ShieldCheck className="w-3 h-3 mr-1 inline" />Admin</> : 'Agente'}
                                        </Badge>
                                        {!isAdmin && (
                                            <span className="text-xs text-slate-500">
                                                {Object.values(permisos).filter(Boolean).length}/{PERMISOS_CONFIG.length} permisos
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-slate-500 text-xs mt-1 flex items-center gap-1">
                                        <Mail className="w-3 h-3" />
                                        {(u as unknown as { email?: string }).email ?? 'Sin email registrado'}
                                    </p>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
                                    {!isAdmin && (
                                        <button
                                            onClick={() => setExpandedPermisos(isExpanded ? null : u.id)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 border border-[#007EC6]/30 text-[#5bbfed] hover:bg-[#007EC6]/10"
                                        >
                                            <Settings2 className="w-3.5 h-3.5" />
                                            Permisos
                                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                        </button>
                                    )}

                                    <button
                                        onClick={() => handleToggleActivo(u)}
                                        disabled={isPending}
                                        className={cn(
                                            'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 border',
                                            u.activo
                                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                                                : 'bg-slate-700/30 border-slate-600/30 text-slate-400 hover:bg-slate-700/50'
                                        )}
                                    >
                                        {u.activo ? <><UserCheck className="w-3.5 h-3.5" />Activo</> : <><UserX className="w-3.5 h-3.5" />Inactivo</>}
                                    </button>

                                    <div className="w-px h-6 bg-white/10 hidden sm:block" />

                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-red-500/25 text-red-400 hover:bg-red-500/10 hover:border-red-500/40 h-8 w-8 p-0"
                                        onClick={() => setDeleteId(u.id)}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>

                            {/* Permisos panel */}
                            {!isAdmin && isExpanded && (
                                <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: 'rgba(0,126,198,0.12)' }}>
                                    <p className="text-xs text-slate-400 font-semibold mb-3 flex items-center gap-1.5">
                                        <Settings2 className="w-3.5 h-3.5 text-[#007EC6]" />
                                        Accesos para {u.full_name.split(' ')[0]}
                                        <span className="text-slate-600 font-normal">— define qué secciones puede ver este agente</span>
                                    </p>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                                        {PERMISOS_CONFIG.map(({ key, label, desc, icon: Icon, colorOn }) => {
                                            const active = permisos[key]
                                            return (
                                                <button
                                                    key={key}
                                                    disabled={isPending}
                                                    onClick={() => handleTogglePermiso(u, key, active)}
                                                    className="rounded-xl p-3 text-left transition-all duration-150"
                                                    style={{
                                                        background: active ? `${colorOn}14` : 'rgba(255,255,255,0.03)',
                                                        border: active ? `1px solid ${colorOn}30` : '1px solid rgba(255,255,255,0.06)',
                                                    }}
                                                >
                                                    <div className="flex items-center justify-between mb-1.5">
                                                        <Icon className="w-4 h-4" style={{ color: active ? colorOn : '#475569' }} />
                                                        <div className={cn('w-7 h-4 rounded-full transition-all duration-200 relative', active ? 'bg-emerald-500' : 'bg-slate-700')}>
                                                            <span className={cn('absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all duration-200', active ? 'left-3.5' : 'left-0.5')} />
                                                        </div>
                                                    </div>
                                                    <p className="text-xs font-semibold" style={{ color: active ? colorOn : '#64748b' }}>{label}</p>
                                                    <p className="text-[10px] mt-0.5" style={{ color: active ? `${colorOn}99` : '#475569' }}>{desc}</p>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* ── Add User Dialog ──────────────────────────────── */}
            <Dialog open={dialogOpen} onOpenChange={v => { if (!v) closeDialog() }}>
                <DialogContent className="max-w-md" style={{ background: '#0c1d38', border: '1px solid rgba(0,126,198,0.2)', color: 'white' }}>
                    <DialogHeader>
                        <DialogTitle className="text-white">Agregar Usuario</DialogTitle>
                    </DialogHeader>

                    {/* Tab selector */}
                    <div className="flex gap-1 p-1 rounded-xl mb-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <button
                            onClick={() => setDialogTab('invitar')}
                            className={cn(
                                'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all duration-150',
                                dialogTab === 'invitar'
                                    ? 'bg-[#007EC6]/20 text-[#5bbfed] border border-[#007EC6]/30'
                                    : 'text-slate-500 hover:text-slate-300'
                            )}
                        >
                            <Send className="w-3.5 h-3.5" />
                            Invitar por email
                        </button>
                        <button
                            onClick={() => setDialogTab('directo')}
                            className={cn(
                                'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all duration-150',
                                dialogTab === 'directo'
                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                                    : 'text-slate-500 hover:text-slate-300'
                            )}
                        >
                            <UserPlus className="w-3.5 h-3.5" />
                            Crear con contraseña
                        </button>
                    </div>

                    {/* ── TAB: Invitar ── */}
                    {dialogTab === 'invitar' && (
                        <form onSubmit={inviteForm.handleSubmit(handleInvite)} className="space-y-4">
                            <div className="text-xs text-slate-500 px-1 pb-1">
                                Se enviará un email con un enlace para que el usuario configure su contraseña.
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-300 text-sm">Nombre completo *</Label>
                                <Input className="bg-white/5 border-white/10 text-white h-10" {...inviteForm.register('full_name')} />
                                {inviteForm.formState.errors.full_name && <p className="text-xs text-red-400">{inviteForm.formState.errors.full_name.message}</p>}
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-300 text-sm">Email *</Label>
                                <Input type="email" className="bg-white/5 border-white/10 text-white h-10" {...inviteForm.register('email')} />
                                {inviteForm.formState.errors.email && <p className="text-xs text-red-400">{inviteForm.formState.errors.email.message}</p>}
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-300 text-sm">Rol *</Label>
                                <Select onValueChange={v => inviteForm.setValue('rol', v as 'admin' | 'agente')} defaultValue="agente">
                                    <SelectTrigger className="bg-white/5 border-white/10 text-white h-10"><SelectValue /></SelectTrigger>
                                    <SelectContent style={{ background: '#0c1d38', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}>
                                        <SelectItem value="agente">Agente</SelectItem>
                                        <SelectItem value="admin">Administrador</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" className="border-white/10 text-slate-300 hover:bg-white/5" onClick={closeDialog}>Cancelar</Button>
                                <Button type="submit" disabled={isPending} className="text-white font-semibold" style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)' }}>
                                    {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Enviando...</> : <><Send className="w-4 h-4 mr-2" />Enviar Invitación</>}
                                </Button>
                            </DialogFooter>
                        </form>
                    )}

                    {/* ── TAB: Crear directo ── */}
                    {dialogTab === 'directo' && (
                        <form onSubmit={directoForm.handleSubmit(handleCrearDirecto)} className="space-y-4">
                            <div className="flex items-start gap-2 text-xs px-1 pb-1 text-emerald-300/80"
                                style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.1)', borderRadius: 10, padding: '8px 10px' }}>
                                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
                                El usuario se crea confirmado, sin email. Puede iniciar sesión inmediatamente con la contraseña que indiques.
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-300 text-sm">Nombre completo *</Label>
                                <Input className="bg-white/5 border-white/10 text-white h-10" {...directoForm.register('full_name')} />
                                {directoForm.formState.errors.full_name && <p className="text-xs text-red-400">{directoForm.formState.errors.full_name.message}</p>}
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-300 text-sm">Email *</Label>
                                <Input type="email" className="bg-white/5 border-white/10 text-white h-10" {...directoForm.register('email')} />
                                {directoForm.formState.errors.email && <p className="text-xs text-red-400">{directoForm.formState.errors.email.message}</p>}
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-300 text-sm">Rol *</Label>
                                <Select onValueChange={v => directoForm.setValue('rol', v as 'admin' | 'agente')} defaultValue="agente">
                                    <SelectTrigger className="bg-white/5 border-white/10 text-white h-10"><SelectValue /></SelectTrigger>
                                    <SelectContent style={{ background: '#0c1d38', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}>
                                        <SelectItem value="agente">Agente</SelectItem>
                                        <SelectItem value="admin">Administrador</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-300 text-sm flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" style={{ color: '#007EC6' }} />Contraseña *</Label>
                                <div className="relative">
                                    <Input
                                        type={showPwd ? 'text' : 'password'}
                                        placeholder="Mínimo 8 caracteres"
                                        className="bg-white/5 border-white/10 text-white h-10 pr-10"
                                        {...directoForm.register('password')}
                                    />
                                    <button type="button" onClick={() => setShowPwd(!showPwd)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                                        {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                {directoForm.formState.errors.password && <p className="text-xs text-red-400">{directoForm.formState.errors.password.message}</p>}
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-300 text-sm flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" style={{ color: '#007EC6' }} />Confirmar contraseña *</Label>
                                <div className="relative">
                                    <Input
                                        type={showConfirm ? 'text' : 'password'}
                                        placeholder="Repite la contraseña"
                                        className="bg-white/5 border-white/10 text-white h-10 pr-10"
                                        style={{
                                            border: confirmVal.length > 0
                                                ? validations.matches ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(239,68,68,0.4)'
                                                : undefined
                                        }}
                                        {...directoForm.register('confirm')}
                                    />
                                    <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                                        {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                {directoForm.formState.errors.confirm && <p className="text-xs text-red-400">{directoForm.formState.errors.confirm.message}</p>}
                            </div>

                            {/* Password checklist */}
                            {pwdValue.length > 0 && (
                                <div className="grid grid-cols-2 gap-1 text-xs p-2.5 rounded-xl"
                                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                    {[
                                        { ok: validations.minLen, label: 'Mínimo 8 caracteres' },
                                        { ok: validations.hasUpper, label: 'Una mayúscula' },
                                        { ok: validations.hasNum, label: 'Un número' },
                                        { ok: validations.matches, label: 'Contraseñas coinciden' },
                                    ].map(({ ok, label }) => (
                                        <div key={label} className="flex items-center gap-1.5">
                                            <CheckCircle2 className="w-3 h-3 shrink-0" style={{ color: ok ? '#10b981' : '#475569' }} />
                                            <span style={{ color: ok ? '#6ee7b7' : '#475569' }}>{label}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <DialogFooter>
                                <Button type="button" variant="outline" className="border-white/10 text-slate-300 hover:bg-white/5" onClick={closeDialog}>Cancelar</Button>
                                <Button type="submit" disabled={isPending} className="text-white font-semibold"
                                    style={{ background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 4px 12px rgba(16,185,129,0.25)' }}>
                                    {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creando...</> : <><UserPlus className="w-4 h-4 mr-2" />Crear Usuario</>}
                                </Button>
                            </DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>

            {/* ── Delete confirm ───────────────────────────────── */}
            <AlertDialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null) }}>
                <AlertDialogContent style={{ background: '#0c1d38', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-white">¿Eliminar usuario?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">Esta acción eliminará permanentemente la cuenta. No se puede deshacer.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-white/10 text-slate-300 hover:bg-white/5">Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} disabled={isPending} className="bg-red-600 hover:bg-red-500 text-white">Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
