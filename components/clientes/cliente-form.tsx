'use client'

import { useTransition, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { ClienteSchema, ClienteFormData } from '@/lib/validations/schemas'
import { createCliente, updateCliente } from '@/lib/actions/clientes'
import { Cliente, Profile } from '@/lib/types'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'

interface ClienteFormProps {
    open: boolean
    onClose: () => void
    cliente?: Cliente
    agentes: Profile[]
}

export function ClienteForm({ open, onClose, cliente, agentes }: ClienteFormProps) {
    const [isPending, startTransition] = useTransition()
    const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<ClienteFormData>({
        resolver: zodResolver(ClienteSchema),
        defaultValues: cliente ? {
            nombre: cliente.nombre,
            apellido: cliente.apellido,
            dni_ruc: cliente.dni_ruc ?? '',
            telefono: cliente.telefono,
            email: cliente.email ?? '',
            direccion: cliente.direccion ?? '',
            notas: cliente.notas ?? '',
            agente_id: cliente.agente_id ?? '',
        } : {},
    })

    // Reset form values when cliente prop changes (edit vs create)
    useEffect(() => {
        if (open) {
            if (cliente) {
                reset({
                    nombre: cliente.nombre,
                    apellido: cliente.apellido,
                    dni_ruc: cliente.dni_ruc ?? '',
                    telefono: cliente.telefono,
                    email: cliente.email ?? '',
                    direccion: cliente.direccion ?? '',
                    notas: cliente.notas ?? '',
                    agente_id: cliente.agente_id ?? '',
                })
            } else {
                reset({
                    nombre: '',
                    apellido: '',
                    dni_ruc: '',
                    telefono: '',
                    email: '',
                    direccion: '',
                    notas: '',
                    agente_id: '',
                })
            }
        }
    }, [open, cliente, reset])

    const onSubmit = (data: ClienteFormData) => {
        startTransition(async () => {
            try {
                if (cliente) {
                    await updateCliente(cliente.id, data)
                    toast.success('Cliente actualizado correctamente')
                } else {
                    await createCliente(data)
                    toast.success('Cliente registrado correctamente')
                }
                reset()
                onClose()
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al guardar')
            }
        })
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
                <DialogHeader>
                    <DialogTitle>{cliente ? 'Editar Cliente' : 'Nuevo Cliente'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Nombre *</Label>
                            <Input className="bg-slate-800 border-white/10 text-white" {...register('nombre')} />
                            {errors.nombre && <p className="text-xs text-red-400">{errors.nombre.message}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Apellido *</Label>
                            <Input className="bg-slate-800 border-white/10 text-white" {...register('apellido')} />
                            {errors.apellido && <p className="text-xs text-red-400">{errors.apellido.message}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Teléfono *</Label>
                            <Input placeholder="809-000-0000" className="bg-slate-800 border-white/10 text-white" {...register('telefono')} />
                            {errors.telefono && <p className="text-xs text-red-400">{errors.telefono.message}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Cédula / RNC</Label>
                            <Input placeholder="000-0000000-0" className="bg-slate-800 border-white/10 text-white" {...register('dni_ruc')} />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Email</Label>
                        <Input type="email" className="bg-slate-800 border-white/10 text-white" {...register('email')} />
                        {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Dirección</Label>
                        <Input className="bg-slate-800 border-white/10 text-white" {...register('direccion')} />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Agente asignado</Label>
                        <Select
                            key={cliente?.agente_id ?? 'no-agent'}
                            onValueChange={v => setValue('agente_id', v)}
                            defaultValue={cliente?.agente_id ?? ''}
                        >
                            <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                                <SelectValue placeholder="Sin asignar" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-white/10 text-white">
                                <SelectItem value="none">Sin asignar</SelectItem>
                                {agentes.map(a => (
                                    <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Notas</Label>
                        <Textarea className="bg-slate-800 border-white/10 text-white resize-none" rows={2} {...register('notas')} />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => { reset(); onClose() }}
                            className="border-white/10 text-slate-300 hover:bg-white/5">
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isPending}
                            className="text-white" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)" }}>
                            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

