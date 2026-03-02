'use client'

import { useState, useTransition, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { PlantillaSchema, PlantillaFormData } from '@/lib/validations/schemas'
import { createPlantilla, updatePlantilla, deletePlantilla } from '@/lib/actions/plantillas'
import { PlantillaMensaje } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, Pencil, Trash2, Loader2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

const ETAPA_OPTIONS = [
    { value: 'preventivo', label: 'Preventivo' },
    { value: 'mora_temprana', label: 'Mora Temprana' },
    { value: 'mora_alta', label: 'Mora Alta' },
    { value: 'recuperacion', label: 'Recuperación' },
    { value: 'referencia', label: 'Referencia' },
]
const ETAPA_CSS: Record<string, string> = {
    preventivo: 'bg-green-500/20 text-green-300',
    mora_temprana: 'bg-yellow-500/20 text-yellow-300',
    mora_alta: 'bg-orange-500/20 text-orange-300',
    recuperacion: 'bg-red-500/20 text-red-300',
    referencia: 'bg-purple-500/20 text-purple-300',
}

const VARIABLES_DISPONIBLES = ['{{nombre}}', '{{apellido}}', '{{monto}}', '{{saldo}}', '{{fecha_corte}}', '{{dias_atraso}}', '{{tasa_interes}}', '{{agente}}']

interface PlantillasViewProps {
    plantillas: PlantillaMensaje[]
}

function PlantillaFormModal({
    open, onClose, plantilla,
}: { open: boolean; onClose: () => void; plantilla?: PlantillaMensaje }) {
    const [isPending, startTransition] = useTransition()
    const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<PlantillaFormData>({
        resolver: zodResolver(PlantillaSchema),
        defaultValues: plantilla ? {
            nombre: plantilla.nombre,
            etapa: plantilla.etapa,
            contenido: plantilla.contenido,
            activo: plantilla.activo,
        } : { activo: true },
    })

    // Reset form when plantilla prop changes (edit vs create)
    useEffect(() => {
        if (open) {
            if (plantilla) {
                reset({
                    nombre: plantilla.nombre,
                    etapa: plantilla.etapa,
                    contenido: plantilla.contenido,
                    activo: plantilla.activo,
                })
            } else {
                reset({
                    nombre: '',
                    etapa: undefined as unknown as PlantillaFormData['etapa'],
                    contenido: '',
                    activo: true,
                })
            }
        }
    }, [open, plantilla, reset])

    const contenido = watch('contenido') ?? ''

    const onSubmit = (data: PlantillaFormData) => {
        startTransition(async () => {
            try {
                if (plantilla) {
                    await updatePlantilla(plantilla.id, data)
                    toast.success('Plantilla actualizada')
                } else {
                    await createPlantilla(data)
                    toast.success('Plantilla creada')
                }
                reset()
                onClose()
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{plantilla ? 'Editar Plantilla' : 'Nueva Plantilla'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Nombre *</Label>
                            <Input className="bg-slate-800 border-white/10 text-white" {...register('nombre')} />
                            {errors.nombre && <p className="text-xs text-red-400">{errors.nombre.message}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Etapa *</Label>
                            <Select onValueChange={v => setValue('etapa', v as PlantillaFormData['etapa'])} defaultValue={plantilla?.etapa}>
                                <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                                    <SelectValue placeholder="Seleccionar etapa..." />
                                </SelectTrigger>
                                <SelectContent className="bg-slate-800 border-white/10 text-white">
                                    {ETAPA_OPTIONS.map(e => (
                                        <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {errors.etapa && <p className="text-xs text-red-400">{errors.etapa.message}</p>}
                        </div>
                    </div>

                    {/* Variables disponibles */}
                    <div className="flex flex-wrap gap-1.5">
                        {VARIABLES_DISPONIBLES.map(v => (
                            <button type="button" key={v}
                                onClick={() => setValue('contenido', contenido + ' ' + v)}
                                className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded hover:bg-indigo-500/30 transition-colors font-mono">
                                {v}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Contenido del mensaje *</Label>
                        <Textarea className="bg-slate-800 border-white/10 text-white resize-none" rows={6} {...register('contenido')} />
                        {errors.contenido && <p className="text-xs text-red-400">{errors.contenido.message}</p>}
                    </div>

                    {/* Preview */}
                    {contenido && (
                        <div className="p-3 rounded-xl bg-slate-700/50 border border-white/5">
                            <p className="text-xs text-slate-500 mb-1">Vista previa (variables no reemplazadas)</p>
                            <p className="text-sm text-slate-200 whitespace-pre-wrap">{contenido}</p>
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <Switch id="activo" checked={!!watch('activo')} onCheckedChange={v => setValue('activo', v)} />
                        <Label htmlFor="activo" className="text-slate-300 cursor-pointer">Plantilla activa</Label>
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

export function PlantillasView({ plantillas }: PlantillasViewProps) {
    const [formOpen, setFormOpen] = useState(false)
    const [editPlantilla, setEditPlantilla] = useState<PlantillaMensaje | undefined>()
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [isPending, startTransition] = useTransition()

    const handleDelete = () => {
        if (!deleteId) return
        startTransition(async () => {
            try {
                await deletePlantilla(deleteId)
                toast.success('Plantilla eliminada')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
            setDeleteId(null)
        })
    }

    return (
        <>
            <div className="flex justify-end">
                <Button onClick={() => { setEditPlantilla(undefined); setFormOpen(true) }}
                    className="text-white gap-2" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)", boxShadow: "0 4px 12px rgba(0,126,198,0.25)" }}>
                    <Plus className="w-4 h-4" />Nueva Plantilla
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {plantillas.length === 0 ? (
                    <div className="col-span-2 text-center p-16 text-slate-500">No hay plantillas</div>
                ) : plantillas.map(p => (
                    <div key={p.id} className="bg-slate-800/50 border border-white/5 rounded-2xl p-5 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4 text-indigo-400" />
                                <h3 className="font-semibold text-white text-sm">{p.nombre}</h3>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', ETAPA_CSS[p.etapa])}>
                                    {ETAPA_OPTIONS.find(e => e.value === p.etapa)?.label}
                                </span>
                                <span className={cn('text-xs', p.activo ? 'text-green-400' : 'text-slate-500')}>
                                    {p.activo ? '● Activa' : '○ Inactiva'}
                                </span>
                            </div>
                        </div>
                        <p className="text-sm text-slate-400 line-clamp-3">{p.contenido}</p>
                        <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="outline" className="border-white/10 text-slate-300 hover:bg-white/5 gap-1.5"
                                onClick={() => { setEditPlantilla(p); setFormOpen(true) }}>
                                <Pencil className="w-3.5 h-3.5" />Editar
                            </Button>
                            <Button size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10 gap-1.5"
                                onClick={() => setDeleteId(p.id)}>
                                <Trash2 className="w-3.5 h-3.5" />Eliminar
                            </Button>
                        </div>
                    </div>
                ))}
            </div>

            <PlantillaFormModal open={formOpen} onClose={() => { setFormOpen(false); setEditPlantilla(undefined) }} plantilla={editPlantilla} />

            <AlertDialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null) }}>
                <AlertDialogContent className="bg-slate-900 border-white/10 text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar plantilla?</AlertDialogTitle>
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

