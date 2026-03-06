'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { TiendaReferidaSchema, TiendaReferidaFormData } from '@/lib/validations/schemas'
import { createTiendaReferida, updateTiendaReferida, deleteTiendaReferida, importarTiendasCsv } from '@/lib/actions/tiendas-referidas'
import { TiendaReferida } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, Pencil, Trash2, Loader2, Search, Upload, Download, Store, AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TiendasReferidaViewProps {
    tiendas: TiendaReferida[]
}

function TiendaFormModal({
    open, onClose, tienda,
}: { open: boolean; onClose: () => void; tienda?: TiendaReferida }) {
    const [isPending, startTransition] = useTransition()
    const { register, handleSubmit, reset, formState: { errors } } = useForm<TiendaReferidaFormData>({
        resolver: zodResolver(TiendaReferidaSchema),
        defaultValues: tienda
            ? { nombre: tienda.nombre, telefono: tienda.telefono, notas: tienda.notas ?? '' }
            : { nombre: '', telefono: '', notas: '' },
    })

    useEffect(() => {
        if (open) {
            reset(tienda
                ? { nombre: tienda.nombre, telefono: tienda.telefono, notas: tienda.notas ?? '' }
                : { nombre: '', telefono: '', notas: '' })
        }
    }, [open, tienda, reset])

    const onSubmit = (data: TiendaReferidaFormData) => {
        startTransition(async () => {
            try {
                if (tienda) {
                    await updateTiendaReferida(tienda.id, data)
                    toast.success('Tienda actualizada')
                } else {
                    await createTiendaReferida(data)
                    toast.success('Tienda registrada')
                }
                reset(); onClose()
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
                <DialogHeader>
                    <DialogTitle>{tienda ? 'Editar Tienda' : 'Nueva Tienda'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Nombre de la tienda *</Label>
                        <Input className="bg-slate-800 border-white/10 text-white" placeholder="Ej: Colmado Don Pedro" {...register('nombre')} />
                        {errors.nombre && <p className="text-xs text-red-400">{errors.nombre.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Teléfono *</Label>
                        <Input className="bg-slate-800 border-white/10 text-white" placeholder="Ej: 8091234567" {...register('telefono')} />
                        {errors.telefono && <p className="text-xs text-red-400">{errors.telefono.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Notas</Label>
                        <Textarea className="bg-slate-800 border-white/10 text-white resize-none" rows={2} placeholder="Opcional..." {...register('notas')} />
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

function ImportCsvModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [isPending, startTransition] = useTransition()
    const [file, setFile] = useState<File | null>(null)
    const [preview, setPreview] = useState<Array<{ nombre: string; telefono: string }>>([])
    const [result, setResult] = useState<{ total: number; insertados: number; errores: string[] } | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (open) { setFile(null); setPreview([]); setResult(null) }
    }, [open])

    const parseCsv = (text: string) => {
        const lines = text.split(/\r?\n/).filter(l => l.trim())
        if (lines.length === 0) return []

        const firstLine = lines[0].toLowerCase()
        const hasHeader = firstLine.includes('nombre') || firstLine.includes('tienda') || firstLine.includes('telefono')
        const dataLines = hasHeader ? lines.slice(1) : lines

        return dataLines.map(line => {
            const parts = line.split(/[,;|\t]/).map(p => p.trim().replace(/^["']|["']$/g, ''))
            return { nombre: parts[0] ?? '', telefono: parts[1] ?? '' }
        }).filter(r => r.nombre || r.telefono)
    }

    const handleFile = (f: File | null) => {
        if (!f) return
        setFile(f)
        setResult(null)
        const reader = new FileReader()
        reader.onload = (e) => {
            const text = e.target?.result as string
            setPreview(parseCsv(text))
        }
        reader.readAsText(f)
    }

    const handleImport = () => {
        if (preview.length === 0) { toast.error('No hay datos para importar'); return }
        startTransition(async () => {
            try {
                const res = await importarTiendasCsv(preview)
                setResult(res)
                if (res.insertados > 0) {
                    toast.success(`${res.insertados} tienda${res.insertados > 1 ? 's' : ''} importada${res.insertados > 1 ? 's' : ''}`)
                }
                if (res.errores.length > 0 && res.insertados === 0) {
                    toast.error('No se pudo importar ninguna tienda')
                }
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error al importar') }
        })
    }

    const downloadTemplate = () => {
        const csv = 'nombre,telefono\nColmado Don Pedro,8091234567\nFerretería López,8297654321\nMini Market La Esquina,8491112233'
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'formato_tiendas_referidas.csv'
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Importar tiendas desde CSV</DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Sube un archivo CSV con las columnas: nombre y teléfono.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 mt-2">
                    <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}
                        className="border-white/10 text-slate-300 hover:bg-white/5 gap-2">
                        <Download className="w-4 h-4" />Descargar formato de ejemplo
                    </Button>

                    <div
                        className={cn(
                            'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
                            file ? 'border-[#007EC6]/50 bg-[#007EC6]/5' : 'border-white/10 hover:border-white/20'
                        )}
                        onClick={() => fileRef.current?.click()}
                        onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                        onDrop={e => { e.preventDefault(); e.stopPropagation(); handleFile(e.dataTransfer.files[0]) }}
                    >
                        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => handleFile(e.target.files?.[0] ?? null)} />
                        <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                        {file ? (
                            <div>
                                <p className="text-sm font-medium text-white">{file.name}</p>
                                <p className="text-xs text-slate-400 mt-1">{preview.length} registros detectados</p>
                            </div>
                        ) : (
                            <div>
                                <p className="text-sm text-slate-400">Haz clic o arrastra tu archivo CSV aquí</p>
                                <p className="text-xs text-slate-500 mt-1">Formato: nombre, teléfono (separado por coma, punto y coma o tabulación)</p>
                            </div>
                        )}
                    </div>

                    {preview.length > 0 && !result && (
                        <div className="space-y-2">
                            <p className="text-sm text-slate-300 font-medium">Vista previa ({preview.length} filas)</p>
                            <div className="bg-slate-800/60 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-white/5 text-slate-500">
                                            <th className="text-left p-2 font-medium">#</th>
                                            <th className="text-left p-2 font-medium">Nombre</th>
                                            <th className="text-left p-2 font-medium">Teléfono</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {preview.slice(0, 20).map((r, i) => (
                                            <tr key={i} className="text-slate-300">
                                                <td className="p-2 text-slate-500">{i + 1}</td>
                                                <td className="p-2">{r.nombre || <span className="text-red-400">vacío</span>}</td>
                                                <td className="p-2">{r.telefono || <span className="text-red-400">vacío</span>}</td>
                                            </tr>
                                        ))}
                                        {preview.length > 20 && (
                                            <tr><td colSpan={3} className="p-2 text-center text-slate-500">... y {preview.length - 20} más</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {result && (
                        <div className="space-y-3">
                            <div className={cn(
                                'flex items-center gap-3 rounded-lg p-3',
                                result.insertados > 0 ? 'bg-green-500/10' : 'bg-red-500/10'
                            )}>
                                {result.insertados > 0
                                    ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                                    : <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                                }
                                <div className="text-sm">
                                    <p className="font-medium text-white">
                                        {result.insertados} de {result.total} tiendas importadas
                                    </p>
                                    {result.errores.length > 0 && (
                                        <p className="text-slate-400 text-xs mt-0.5">{result.errores.length} errores</p>
                                    )}
                                </div>
                            </div>
                            {result.errores.length > 0 && (
                                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 max-h-32 overflow-y-auto">
                                    {result.errores.map((err, i) => (
                                        <p key={i} className="text-xs text-red-300">{err}</p>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" className="border-white/10 text-slate-300" onClick={onClose}>
                        {result ? 'Cerrar' : 'Cancelar'}
                    </Button>
                    {!result && (
                        <Button onClick={handleImport} disabled={isPending || preview.length === 0} className="text-white gap-2"
                            style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)" }}>
                            {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Importando...</> : <><Upload className="w-4 h-4" />Importar {preview.length > 0 && `(${preview.length})`}</>}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function TiendasReferidasView({ tiendas }: TiendasReferidaViewProps) {
    const [search, setSearch] = useState('')
    const [formOpen, setFormOpen] = useState(false)
    const [csvOpen, setCsvOpen] = useState(false)
    const [editTienda, setEditTienda] = useState<TiendaReferida | undefined>()
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [isPending, startTransition] = useTransition()

    const filtered = tiendas.filter(t => {
        const term = search.toLowerCase()
        return `${t.nombre} ${t.telefono}`.toLowerCase().includes(term)
    })

    const handleDelete = () => {
        if (!deleteId) return
        startTransition(async () => {
            try { await deleteTiendaReferida(deleteId); toast.success('Tienda eliminada') }
            catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
            setDeleteId(null)
        })
    }

    return (
        <>
            {/* Info banner */}
            <div className="bg-[#007EC6]/5 border border-[#007EC6]/20 rounded-xl p-4 flex items-start gap-3">
                <Store className="w-5 h-5 text-[#007EC6] shrink-0 mt-0.5" />
                <div>
                    <p className="text-sm font-medium text-white">Tiendas Referidoras</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                        Registro de tiendas que tienen acceso a la IA de referidos. Este apartado es independiente del sistema de cobranza.
                    </p>
                </div>
            </div>

            {/* Actions bar */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o teléfono..."
                        className="pl-9 bg-slate-800 border-white/10 text-white placeholder:text-slate-500" />
                </div>
                <div className="flex gap-2">
                    <Button onClick={() => setCsvOpen(true)} variant="outline"
                        className="border-white/10 text-slate-300 hover:bg-white/5 gap-2">
                        <Upload className="w-4 h-4" />Importar CSV
                    </Button>
                    <Button onClick={() => { setEditTienda(undefined); setFormOpen(true) }} className="text-white gap-2"
                        style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)", boxShadow: "0 4px 12px rgba(0,126,198,0.25)" }}>
                        <Plus className="w-4 h-4" />Nueva Tienda
                    </Button>
                </div>
            </div>

            {/* Stats */}
            <div className="bg-slate-800/50 border border-white/5 rounded-xl p-4 inline-flex items-center gap-3">
                <p className="text-2xl font-bold text-white">{tiendas.length}</p>
                <p className="text-sm text-slate-400">tiendas registradas</p>
            </div>

            {/* Table */}
            <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/5 text-slate-500 text-xs">
                                <th className="text-left p-4 font-medium">Tienda</th>
                                <th className="text-left p-4 font-medium">Teléfono</th>
                                <th className="text-left p-4 font-medium">Notas</th>
                                <th className="text-left p-4 font-medium">Registrada</th>
                                <th className="text-center p-4 font-medium">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center p-12 text-slate-500">
                                        {search ? 'No se encontraron resultados' : 'No hay tiendas registradas'}
                                    </td>
                                </tr>
                            ) : filtered.map(t => (
                                <tr key={t.id} className="text-slate-300 hover:bg-white/3 transition-colors">
                                    <td className="p-4">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-lg bg-[#007EC6]/10 flex items-center justify-center shrink-0">
                                                <Store className="w-4 h-4 text-[#007EC6]" />
                                            </div>
                                            <span className="font-semibold text-white">{t.nombre}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 font-mono text-xs">{t.telefono}</td>
                                    <td className="p-4 max-w-[200px] truncate text-slate-400 text-xs">{t.notas ?? '—'}</td>
                                    <td className="p-4 text-xs text-slate-500">
                                        {new Date(t.created_at).toLocaleDateString('es-DO')}
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="flex justify-center gap-2">
                                            <Button size="sm" variant="outline" className="border-white/10 text-slate-300 hover:bg-white/5 h-8 w-8 p-0"
                                                onClick={() => { setEditTienda(t); setFormOpen(true) }}>
                                                <Pencil className="w-3.5 h-3.5" />
                                            </Button>
                                            <Button size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-8 w-8 p-0"
                                                onClick={() => setDeleteId(t.id)}>
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

            <TiendaFormModal open={formOpen} onClose={() => { setFormOpen(false); setEditTienda(undefined) }} tienda={editTienda} />
            <ImportCsvModal open={csvOpen} onClose={() => setCsvOpen(false)} />

            <AlertDialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null) }}>
                <AlertDialogContent className="bg-slate-900 border-white/10 text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar tienda?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">Esta acción no se puede deshacer. La tienda será eliminada permanentemente.</AlertDialogDescription>
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
