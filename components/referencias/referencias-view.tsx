'use client'

import { useState, useTransition, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { ReferenciaSchema, ReferenciaFormData } from '@/lib/validations/schemas'
import { createReferencia, updateReferencia, deleteReferencia } from '@/lib/actions/referencias'
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
import { Plus, Pencil, Trash2, Loader2, Search } from 'lucide-react'
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

function ReferenciaFormModal({
    open, onClose, referencia, clientes,
}: { open: boolean; onClose: () => void; referencia?: ReferenciaCliente; clientes: ClienteSimple[] }) {
    const [isPending, startTransition] = useTransition()
    const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<ReferenciaFormData>({
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

    // Reset form when referencia prop changes (edit vs create)
    useEffect(() => {
        if (open) {
            if (referencia) {
                reset({
                    cliente_id: referencia.cliente_id,
                    nombre: referencia.nombre,
                    telefono: referencia.telefono,
                    relacion: referencia.relacion ?? '',
                    estado_contacto: referencia.estado_contacto,
                    notas: referencia.notas ?? '',
                })
            } else {
                reset({
                    cliente_id: '',
                    nombre: '',
                    telefono: '',
                    relacion: '',
                    estado_contacto: 'pendiente',
                    notas: '',
                })
            }
        }
    }, [open, referencia, reset])

    const onSubmit = (data: ReferenciaFormData) => {
        startTransition(async () => {
            try {
                if (referencia) {
                    await updateReferencia(referencia.id, data)
                    toast.success('Referencia actualizada')
                } else {
                    await createReferencia(data)
                    toast.success('Referencia registrada')
                }
                reset(); onClose()
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
                <DialogHeader><DialogTitle>{referencia ? 'Editar Referencia' : 'Nueva Referencia'}</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Cliente *</Label>
                        <Select onValueChange={v => setValue('cliente_id', v)} defaultValue={referencia?.cliente_id ?? ''}>
                            <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                                <SelectValue placeholder="Seleccionar cliente..." />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-white/10 text-white">
                                {clientes.map(c => (
                                    <SelectItem key={c.id} value={c.id}>{c.nombre} {c.apellido}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {errors.cliente_id && <p className="text-xs text-red-400">{errors.cliente_id.message}</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Nombre de la referencia *</Label>
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
                            <Input placeholder="Familiar, amigo, trabajo..." className="bg-slate-800 border-white/10 text-white" {...register('relacion')} />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Estado de contacto</Label>
                            <Select onValueChange={v => setValue('estado_contacto', v as ReferenciaFormData['estado_contacto'])} defaultValue={referencia?.estado_contacto ?? 'pendiente'}>
                                <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                                    <SelectValue />
                                </SelectTrigger>
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

                    <DialogFooter>
                        <Button type="button" variant="outline" className="border-white/10 text-slate-300" onClick={() => { reset(); onClose() }}>Cancelar</Button>
                        <Button type="submit" disabled={isPending} className="text-white" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)" }}>
                            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export function ReferenciasView({ referencias, clientes }: ReferenciasViewProps) {
    const [search, setSearch] = useState('')
    const [formOpen, setFormOpen] = useState(false)
    const [editRef, setEditRef] = useState<ReferenciaCliente | undefined>()
    const [deleteId, setDeleteId] = useState<string | null>(null)
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

