'use client'

import { useState, useTransition, useEffect, useMemo, useRef, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { ReferenciaSchema, ReferenciaFormData } from '@/lib/validations/schemas'
import { createReferencia, updateReferencia, deleteReferencia, enviarNotificacionReferencia, getDeudasPorCliente } from '@/lib/actions/referencias'
import { ReferenciaCliente } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, Pencil, Trash2, Loader2, Search, Send, X, ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ClienteSimple { id: string; nombre: string; apellido: string }
interface ReferenciasViewProps {
    referencias: (ReferenciaCliente & { cliente?: ClienteSimple | null })[]
    clientes: ClienteSimple[]
}

const ESTADO_CSS: Record<string, string> = {
    pendiente: 'bg-slate-500/20 text-slate-400',
    contactado: 'bg-green-500/20 text-green-300',
    entregado: 'bg-blue-500/20 text-blue-300',
    no_responde: 'bg-red-500/20 text-red-300',
}

interface RefEntry {
    nombre: string
    telefono: string
    relacion: string
}

const emptyEntry = (): RefEntry => ({ nombre: '', telefono: '', relacion: '' })

function ReferenciaFormModal({
    open, onClose, referencia, clientes,
}: { open: boolean; onClose: () => void; referencia?: ReferenciaCliente; clientes: ClienteSimple[] }) {
    const [isPending, startTransition] = useTransition()
    const isEdit = !!referencia

    const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<ReferenciaFormData>({
        resolver: zodResolver(ReferenciaSchema),
        defaultValues: referencia ? {
            cliente_id: referencia.cliente_id,
            nombre: referencia.nombre,
            telefono: referencia.telefono,
            relacion: referencia.relacion ?? '',
            estado_contacto: referencia.estado_contacto,
            notas: referencia.notas ?? '',
        } : { estado_contacto: 'pendiente' },
    })

    const [entries, setEntries] = useState<RefEntry[]>([emptyEntry()])
    const [clienteSearch, setClienteSearch] = useState('')
    const [clienteDropdownOpen, setClienteDropdownOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    const clienteId = watch('cliente_id')
    const selectedCliente = clientes.find(c => c.id === clienteId)

    const filteredClientes = useMemo(() => {
        if (!clienteSearch.trim()) return clientes
        const term = clienteSearch.toLowerCase()
        return clientes.filter(c =>
            `${c.nombre} ${c.apellido}`.toLowerCase().includes(term)
        )
    }, [clientes, clienteSearch])

    useEffect(() => {
        if (!clienteDropdownOpen) return
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setClienteDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [clienteDropdownOpen])

    useEffect(() => {
        if (open) {
            setClienteSearch('')
            setClienteDropdownOpen(false)
            if (referencia) {
                reset({
                    cliente_id: referencia.cliente_id,
                    nombre: referencia.nombre,
                    telefono: referencia.telefono,
                    relacion: referencia.relacion ?? '',
                    estado_contacto: referencia.estado_contacto,
                    notas: referencia.notas ?? '',
                })
                setEntries([{ nombre: referencia.nombre, telefono: referencia.telefono, relacion: referencia.relacion ?? '' }])
            } else {
                reset({ cliente_id: '', nombre: '', telefono: '', relacion: '', estado_contacto: 'pendiente', notas: '' })
                setEntries([emptyEntry()])
            }
        }
    }, [open, referencia, reset])

    const updateEntry = useCallback((idx: number, field: keyof RefEntry, value: string) => {
        setEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e))
    }, [])

    const addEntry = () => setEntries(prev => [...prev, emptyEntry()])

    const removeEntry = (idx: number) => {
        setEntries(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx))
    }

    const onSubmitEdit = (data: ReferenciaFormData) => {
        startTransition(async () => {
            try {
                await updateReferencia(referencia!.id, data)
                toast.success('Referencia actualizada')
                reset(); onClose()
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    const onSubmitCreate = () => {
        if (!clienteId) { toast.error('Selecciona un cliente'); return }
        const valid = entries.filter(e => e.nombre.trim() && e.telefono.trim())
        if (valid.length === 0) { toast.error('Agrega al menos una referencia con nombre y teléfono'); return }

        startTransition(async () => {
            let success = 0
            for (const entry of valid) {
                try {
                    await createReferencia({
                        cliente_id: clienteId,
                        nombre: entry.nombre.trim(),
                        telefono: entry.telefono.trim(),
                        relacion: entry.relacion.trim() || undefined,
                        estado_contacto: 'pendiente',
                        notas: undefined,
                    } as ReferenciaFormData)
                    success++
                } catch { /* continue */ }
            }
            if (success > 0) {
                toast.success(success === 1 ? 'Referencia registrada' : `${success} referencias registradas`)
            }
            reset(); onClose()
        })
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEdit ? 'Editar Referencia' : 'Nuevas Referencias'}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 mt-2">
                    {/* Searchable client selector */}
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Cliente *</Label>
                        <div className="relative" ref={dropdownRef}>
                            <button
                                type="button"
                                className={cn(
                                    'w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm bg-slate-800 border transition-colors text-left',
                                    clienteDropdownOpen ? 'border-[#007EC6]/50' : 'border-white/10',
                                    selectedCliente ? 'text-white' : 'text-slate-500'
                                )}
                                onClick={() => setClienteDropdownOpen(!clienteDropdownOpen)}
                            >
                                {selectedCliente ? `${selectedCliente.nombre} ${selectedCliente.apellido}` : 'Buscar cliente...'}
                                <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform', clienteDropdownOpen && 'rotate-180')} />
                            </button>
                            {clienteDropdownOpen && (
                                <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-white/10 rounded-lg shadow-xl overflow-hidden">
                                    <div className="p-2 border-b border-white/5">
                                        <div className="relative">
                                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                                            <input
                                                type="text"
                                                value={clienteSearch}
                                                onChange={e => setClienteSearch(e.target.value)}
                                                placeholder="Buscar por nombre..."
                                                className="w-full pl-8 pr-3 py-2 bg-slate-900 border border-white/10 rounded-md text-sm text-white placeholder:text-slate-500 outline-none focus:border-[#007EC6]/50"
                                                autoFocus
                                            />
                                        </div>
                                    </div>
                                    <div className="overflow-y-auto max-h-48">
                                        {filteredClientes.length === 0 ? (
                                            <div className="p-4 text-center text-slate-500 text-sm">No se encontraron clientes</div>
                                        ) : filteredClientes.map(c => (
                                            <button
                                                key={c.id}
                                                type="button"
                                                className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 flex items-center justify-between"
                                                onClick={() => {
                                                    setValue('cliente_id', c.id)
                                                    setClienteDropdownOpen(false)
                                                    setClienteSearch('')
                                                }}
                                            >
                                                <span className="text-sm text-white">{c.nombre} {c.apellido}</span>
                                                {clienteId === c.id && <Check className="w-4 h-4 text-[#007EC6]" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        {errors.cliente_id && <p className="text-xs text-red-400">{errors.cliente_id.message}</p>}
                    </div>

                    {isEdit ? (
                        /* Edit mode: single reference with full fields */
                        <form id="edit-ref-form" onSubmit={handleSubmit(onSubmitEdit)} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label className="text-slate-300">Nombre *</Label>
                                    <Input className="bg-slate-800 border-white/10 text-white" {...register('nombre')} />
                                    {errors.nombre && <p className="text-xs text-red-400">{errors.nombre.message}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-slate-300">Teléfono *</Label>
                                    <Input className="bg-slate-800 border-white/10 text-white" {...register('telefono')} />
                                    {errors.telefono && <p className="text-xs text-red-400">{errors.telefono.message}</p>}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label className="text-slate-300">Relación</Label>
                                    <Input placeholder="Familiar, amigo..." className="bg-slate-800 border-white/10 text-white" {...register('relacion')} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-slate-300">Estado</Label>
                                    <Select onValueChange={v => setValue('estado_contacto', v as ReferenciaFormData['estado_contacto'])} defaultValue={referencia?.estado_contacto ?? 'pendiente'}>
                                        <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue /></SelectTrigger>
                                        <SelectContent className="bg-slate-800 border-white/10 text-white">
                                            <SelectItem value="pendiente">Pendiente</SelectItem>
                                            <SelectItem value="contactado">Contactado</SelectItem>
                                            <SelectItem value="entregado">Entregado</SelectItem>
                                            <SelectItem value="no_responde">No responde</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-300">Notas</Label>
                                <Textarea className="bg-slate-800 border-white/10 text-white resize-none" rows={2} {...register('notas')} />
                            </div>
                        </form>
                    ) : (
                        /* Create mode: multiple references */
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-slate-300">Referencias ({entries.length})</Label>
                                <Button type="button" size="sm" variant="outline"
                                    className="border-white/10 text-slate-300 hover:bg-white/5 h-7 px-2 gap-1 text-xs"
                                    onClick={addEntry}>
                                    <Plus className="w-3 h-3" />Agregar
                                </Button>
                            </div>
                            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                                {entries.map((entry, idx) => (
                                    <div key={idx} className="bg-slate-800/60 rounded-lg p-3 space-y-2 relative group">
                                        {entries.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeEntry(idx)}
                                                className="absolute top-2 right-2 w-5 h-5 rounded-full bg-slate-700 hover:bg-red-500/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X className="w-3 h-3 text-white" />
                                            </button>
                                        )}
                                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                                            <span className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300">{idx + 1}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <Input
                                                placeholder="Nombre *"
                                                value={entry.nombre}
                                                onChange={e => updateEntry(idx, 'nombre', e.target.value)}
                                                className="bg-slate-900 border-white/10 text-white text-sm h-9"
                                            />
                                            <Input
                                                placeholder="Teléfono *"
                                                value={entry.telefono}
                                                onChange={e => updateEntry(idx, 'telefono', e.target.value)}
                                                className="bg-slate-900 border-white/10 text-white text-sm h-9"
                                            />
                                            <Input
                                                placeholder="Relación"
                                                value={entry.relacion}
                                                onChange={e => updateEntry(idx, 'relacion', e.target.value)}
                                                className="bg-slate-900 border-white/10 text-white text-sm h-9"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" className="border-white/10 text-slate-300" onClick={() => { reset(); onClose() }}>Cancelar</Button>
                    {isEdit ? (
                        <Button type="submit" form="edit-ref-form" disabled={isPending} className="text-white" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)" }}>
                            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar'}
                        </Button>
                    ) : (
                        <Button type="button" onClick={onSubmitCreate} disabled={isPending} className="text-white gap-2" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)" }}>
                            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : <><Plus className="w-4 h-4" />Guardar {entries.length > 1 ? `(${entries.length})` : ''}</>}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

interface DeudaSimple {
    id: string
    monto_original: number
    saldo_pendiente: number
    fecha_corte: string
    etapa: string
    estado: string
}

function EnviarNotificacionModal({
    open, onClose, referencia,
}: { open: boolean; onClose: () => void; referencia: ReferenciaCliente & { cliente?: ClienteSimple | null } }) {
    const [isPending, startTransition] = useTransition()
    const [deudas, setDeudas] = useState<DeudaSimple[]>([])
    const [loadingDeudas, setLoadingDeudas] = useState(false)
    const [selectedDeudaId, setSelectedDeudaId] = useState<string>('')

    useEffect(() => {
        if (open && referencia?.cliente_id) {
            setLoadingDeudas(true)
            setSelectedDeudaId('')
            getDeudasPorCliente(referencia.cliente_id)
                .then(d => { setDeudas(d); if (d.length === 1) setSelectedDeudaId(d[0].id) })
                .catch(() => setDeudas([]))
                .finally(() => setLoadingDeudas(false))
        }
    }, [open, referencia?.cliente_id])

    const handleEnviar = () => {
        if (!selectedDeudaId) { toast.error('Selecciona una cuenta'); return }
        startTransition(async () => {
            try {
                await enviarNotificacionReferencia(referencia.id, selectedDeudaId)
                toast.success(`Notificación enviada a ${referencia.nombre}`)
                onClose()
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error al enviar') }
        })
    }

    const formatMonto = (n: number) => n ? `RD$${n.toLocaleString('es-DO')}` : 'Sin monto'

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
                <DialogHeader>
                    <DialogTitle>Enviar notificación</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                    <div className="bg-slate-800/60 rounded-lg p-3 space-y-1">
                        <p className="text-sm text-slate-400">Referencia</p>
                        <p className="font-semibold">{referencia.nombre} — {referencia.telefono}</p>
                        {referencia.relacion && <p className="text-xs text-slate-500">{referencia.relacion}</p>}
                    </div>
                    <div className="bg-slate-800/60 rounded-lg p-3 space-y-1">
                        <p className="text-sm text-slate-400">Cliente asociado</p>
                        <p className="font-semibold">{referencia.cliente ? `${referencia.cliente.nombre} ${referencia.cliente.apellido}` : '—'}</p>
                    </div>

                    {loadingDeudas ? (
                        <div className="flex items-center gap-2 text-slate-400 text-sm py-3">
                            <Loader2 className="w-4 h-4 animate-spin" />Cargando cuentas...
                        </div>
                    ) : deudas.length === 0 ? (
                        <p className="text-sm text-red-400 py-2">Este cliente no tiene cuentas activas.</p>
                    ) : (
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Cuenta del cliente</Label>
                            <Select onValueChange={setSelectedDeudaId} value={selectedDeudaId}>
                                <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                                    <SelectValue placeholder="Seleccionar cuenta..." />
                                </SelectTrigger>
                                <SelectContent className="bg-slate-800 border-white/10 text-white">
                                    {deudas.map(d => (
                                        <SelectItem key={d.id} value={d.id}>
                                            {formatMonto(d.saldo_pendiente)} — Vence {d.fecha_corte} ({d.etapa.replace('_', ' ')})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <p className="text-xs text-slate-500">Se usará la plantilla de referencia activa para generar el mensaje.</p>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" className="border-white/10 text-slate-300" onClick={onClose}>Cancelar</Button>
                    <Button onClick={handleEnviar} disabled={isPending || !selectedDeudaId || deudas.length === 0} className="text-white gap-2" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)" }}>
                        {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Enviando...</> : <><Send className="w-4 h-4" />Enviar notificación</>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function ReferenciasView({ referencias, clientes }: ReferenciasViewProps) {
    const [search, setSearch] = useState('')
    const [formOpen, setFormOpen] = useState(false)
    const [editRef, setEditRef] = useState<ReferenciaCliente | undefined>()
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [sendRef, setSendRef] = useState<(ReferenciaCliente & { cliente?: ClienteSimple | null }) | null>(null)
    const [isPending, startTransition] = useTransition()

    const filtered = referencias.filter(r => {
        const term = search.toLowerCase()
        return `${r.nombre} ${r.telefono} ${r.cliente?.nombre ?? ''} ${r.cliente?.apellido ?? ''}`.toLowerCase().includes(term)
    })

    const handleDelete = () => {
        if (!deleteId) return
        startTransition(async () => {
            try { await deleteReferencia(deleteId); toast.success('Referencia eliminada') }
            catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
            setDeleteId(null)
        })
    }

    return (
        <>
            <div className="flex gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar referencias..."
                        className="pl-9 bg-slate-800 border-white/10 text-white placeholder:text-slate-500" />
                </div>
                <Button onClick={() => { setEditRef(undefined); setFormOpen(true) }} className="text-white gap-2" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)", boxShadow: "0 4px 12px rgba(0,126,198,0.25)" }}>
                    <Plus className="w-4 h-4" />Nueva Referencia
                </Button>
            </div>

            <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/5 text-slate-500 text-xs">
                                <th className="text-left p-4 font-medium">Referencia</th>
                                <th className="text-left p-4 font-medium">Teléfono</th>
                                <th className="text-left p-4 font-medium">Relación</th>
                                <th className="text-left p-4 font-medium">Cliente</th>
                                <th className="text-left p-4 font-medium">Estado</th>
                                <th className="text-center p-4 font-medium">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filtered.length === 0 ? (
                                <tr><td colSpan={6} className="text-center p-12 text-slate-500">No se encontraron referencias</td></tr>
                            ) : filtered.map(r => (
                                <tr key={r.id} className="text-slate-300 hover:bg-white/3 transition-colors">
                                    <td className="p-4 font-semibold text-white">{r.nombre}</td>
                                    <td className="p-4">{r.telefono}</td>
                                    <td className="p-4">{r.relacion ?? '—'}</td>
                                    <td className="p-4">{r.cliente ? `${r.cliente.nombre} ${r.cliente.apellido}` : '—'}</td>
                                    <td className="p-4">
                                        <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_CSS[r.estado_contacto])}>
                                            {r.estado_contacto.replace('_', ' ')}
                                        </span>
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="flex justify-center gap-2">
                                            <Button size="sm" variant="outline" className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 h-8 px-2 gap-1 text-xs"
                                                title="Enviar notificación"
                                                onClick={() => setSendRef(r)}>
                                                <Send className="w-3.5 h-3.5" />
                                                <span className="hidden sm:inline">Notificar</span>
                                            </Button>
                                            <Button size="sm" variant="outline" className="border-white/10 text-slate-300 hover:bg-white/5 h-8 w-8 p-0"
                                                onClick={() => { setEditRef(r); setFormOpen(true) }}>
                                                <Pencil className="w-3.5 h-3.5" />
                                            </Button>
                                            <Button size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-8 w-8 p-0"
                                                onClick={() => setDeleteId(r.id)}>
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <ReferenciaFormModal open={formOpen} onClose={() => { setFormOpen(false); setEditRef(undefined) }} referencia={editRef} clientes={clientes} />

            {sendRef && (
                <EnviarNotificacionModal open={!!sendRef} onClose={() => setSendRef(null)} referencia={sendRef} />
            )}

            <AlertDialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null) }}>
                <AlertDialogContent className="bg-slate-900 border-white/10 text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar referencia?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">Esta acción no se puede deshacer.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-white/10 text-slate-300">Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} disabled={isPending} className="bg-red-600 hover:bg-red-500 text-white">Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

