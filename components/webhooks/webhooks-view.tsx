'use client'

import { useState, useTransition, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { WebhookSchema, WebhookFormData } from '@/lib/validations/schemas'
import { createWebhook, updateWebhook, deleteWebhook, testWebhook } from '@/lib/actions/webhooks'
import { Webhook } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, Pencil, Trash2, Loader2, Webhook as WebhookIcon, CheckCircle, XCircle, TestTube, Send, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WebhooksViewProps { webhooks: Webhook[] }

function WebhookFormModal({ open, onClose, webhook }: { open: boolean; onClose: () => void; webhook?: Webhook }) {
    const [isPending, startTransition] = useTransition()
    const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<WebhookFormData>({
        resolver: zodResolver(WebhookSchema),
        defaultValues: webhook ? { nombre: webhook.nombre, url: webhook.url, descripcion: webhook.descripcion ?? '', activo: webhook.activo } : { activo: true },
    })

    // Reset form when webhook prop changes (edit vs create)
    useEffect(() => {
        if (open) {
            if (webhook) {
                reset({
                    nombre: webhook.nombre,
                    url: webhook.url,
                    descripcion: webhook.descripcion ?? '',
                    activo: webhook.activo,
                })
            } else {
                reset({
                    nombre: '',
                    url: '',
                    descripcion: '',
                    activo: true,
                })
            }
        }
    }, [open, webhook, reset])

    const onSubmit = (data: WebhookFormData) => {
        startTransition(async () => {
            try {
                if (webhook) {
                    await updateWebhook(webhook.id, data)
                    toast.success('Webhook actualizado')
                } else {
                    await createWebhook(data)
                    toast.success('Webhook creado')
                }
                reset(); onClose()
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
                <DialogHeader><DialogTitle>{webhook ? 'Editar Webhook' : 'Nuevo Webhook'}</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Nombre *</Label>
                        <Input className="bg-slate-800 border-white/10 text-white" {...register('nombre')} />
                        {errors.nombre && <p className="text-xs text-red-400">{errors.nombre.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">URL del Webhook *</Label>
                        <Input type="url" placeholder="https://n8n.tu-servidor.com/webhook/..." className="bg-slate-800 border-white/10 text-white font-mono text-sm" {...register('url')} />
                        {errors.url && <p className="text-xs text-red-400">{errors.url.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Descripción</Label>
                        <Textarea className="bg-slate-800 border-white/10 text-white resize-none" rows={2} {...register('descripcion')} />
                    </div>
                    <div className="flex items-center gap-3">
                        <Switch id="wh-activo" checked={!!watch('activo')} onCheckedChange={v => setValue('activo', v)} />
                        <Label htmlFor="wh-activo" className="text-slate-300 cursor-pointer">Webhook activo (recibe envíos del cron)</Label>
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

function WebhookTestModal({ open, onClose, webhook }: { open: boolean; onClose: () => void; webhook: Webhook | null }) {
    const [isPending, startTransition] = useTransition()
    const [result, setResult] = useState<{ ok: boolean; status: number; body?: string } | null>(null)
    const [showPayload, setShowPayload] = useState(true)

    const samplePayload = {
        evento: 'recordatorio_cobranza',
        timestamp: new Date().toISOString(),
        enviado_por: 'manual',
        etapa: 'mora_temprana',
        tipo_destino: 'cliente',
        cliente: {
            id: '00000000-0000-0000-0000-000000000001',
            nombre: 'Juan',
            apellido: 'Pérez',
            telefono: '809-555-1234',
            email: 'juan.perez@ejemplo.com',
        },
        deuda: {
            id: '00000000-0000-0000-0000-000000000002',
            monto_original: 50000.00,
            saldo_pendiente: 35000.00,
            tasa_interes: 2.5,
            fecha_corte: '2026-03-01',
            dias_atraso: 15,
        },
        mensaje: 'Estimado Juan Pérez, le recordamos que tiene un saldo pendiente de RD$35,000.00. Favor contactarnos para coordinar su pago. — Inversiones Cordero',
        agente: {
            id: '00000000-0000-0000-0000-000000000003',
            nombre: 'María García',
        },
    }

    const handleSendTest = () => {
        if (!webhook) return
        startTransition(async () => {
            try {
                const res = await testWebhook(webhook.id)
                setResult(res as { ok: boolean; status: number; body?: string })
                if (res.ok) {
                    toast.success(`Prueba exitosa — HTTP ${res.status}`)
                } else {
                    toast.error(`Respuesta HTTP ${res.status}`)
                }
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al enviar prueba')
                setResult(null)
            }
        })
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) { setResult(null); onClose() } }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <TestTube className="w-5 h-5 text-indigo-400" />
                        Probar Webhook
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                    {/* Webhook info */}
                    <div className="p-3 rounded-xl bg-slate-800/50 border border-white/5 space-y-1">
                        <p className="text-sm font-semibold text-white">{webhook?.nombre}</p>
                        <p className="text-xs text-slate-500 font-mono truncate">{webhook?.url}</p>
                    </div>

                    {/* Payload preview */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Payload de prueba (datos ficticios)</p>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-slate-400 hover:text-white h-7 px-2"
                                onClick={() => setShowPayload(!showPayload)}
                            >
                                {showPayload ? <EyeOff className="w-3.5 h-3.5 mr-1" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
                                {showPayload ? 'Ocultar' : 'Mostrar'}
                            </Button>
                        </div>
                        {showPayload && (
                            <pre className="text-xs text-slate-300 bg-slate-950 border border-white/5 rounded-xl p-4 overflow-auto max-h-64 font-mono">
                                {JSON.stringify(samplePayload, null, 2)}
                            </pre>
                        )}
                    </div>

                    {/* Result */}
                    {result && (
                        <div className={cn(
                            'p-3 rounded-xl border flex items-center gap-3',
                            result.ok
                                ? 'bg-green-500/10 border-green-500/20'
                                : 'bg-red-500/10 border-red-500/20'
                        )}>
                            {result.ok
                                ? <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                                : <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                            }
                            <div>
                                <p className={cn('text-sm font-semibold', result.ok ? 'text-green-300' : 'text-red-300')}>
                                    {result.ok ? 'Conexión exitosa' : 'Error en la conexión'}
                                </p>
                                <p className="text-xs text-slate-400">
                                    Código HTTP: <span className="font-mono font-semibold">{result.status}</span>
                                </p>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" className="border-white/10 text-slate-300" onClick={() => { setResult(null); onClose() }}>
                            Cerrar
                        </Button>
                        <Button
                            type="button"
                            disabled={isPending}
                            onClick={handleSendTest}
                            className="text-white gap-2" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)", boxShadow: "0 4px 12px rgba(0,126,198,0.25)" }}
                        >
                            {isPending ? (
                                <><Loader2 className="w-4 h-4 animate-spin" />Enviando...</>
                            ) : (
                                <><Send className="w-4 h-4" />Enviar prueba</>
                            )}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export function WebhooksView({ webhooks }: WebhooksViewProps) {
    const [formOpen, setFormOpen] = useState(false)
    const [editWebhook, setEditWebhook] = useState<Webhook | undefined>()
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [testWebhookData, setTestWebhookData] = useState<Webhook | null>(null)
    const [testResult, setTestResult] = useState<Record<string, { ok: boolean; status: number } | null>>({})
    const [isPending, startTransition] = useTransition()

    const handleQuickTest = (id: string) => {
        startTransition(async () => {
            try {
                const result = await testWebhook(id)
                setTestResult(prev => ({ ...prev, [id]: result as { ok: boolean; status: number } }))
                toast.success(`Prueba enviada — HTTP ${result.status}`)
            } catch (e: unknown) {
                setTestResult(prev => ({ ...prev, [id]: null }))
                toast.error(e instanceof Error ? e.message : 'Error al probar')
            }
        })
    }

    const handleDelete = () => {
        if (!deleteId) return
        startTransition(async () => {
            try { await deleteWebhook(deleteId); toast.success('Webhook eliminado') }
            catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
            setDeleteId(null)
        })
    }

    return (
        <>
            <div className="flex justify-end">
                <Button onClick={() => { setEditWebhook(undefined); setFormOpen(true) }} className="text-white gap-2" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)", boxShadow: "0 4px 12px rgba(0,126,198,0.25)" }}>
                    <Plus className="w-4 h-4" />Nuevo Webhook
                </Button>
            </div>

            <div className="space-y-4">
                {webhooks.length === 0 ? (
                    <div className="text-center p-16 text-slate-500 bg-slate-800/50 border border-white/5 rounded-2xl">
                        No hay webhooks configurados
                    </div>
                ) : webhooks.map(w => {
                    const tr = testResult[w.id]
                    return (
                        <div key={w.id} className="bg-slate-800/50 border border-white/5 rounded-2xl p-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-start gap-3 flex-1 min-w-0">
                                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                                        w.activo ? 'bg-green-500/20' : 'bg-slate-500/20')}>
                                        <WebhookIcon className={cn('w-4.5 h-4.5', w.activo ? 'text-green-400' : 'text-slate-500')} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-semibold text-white">{w.nombre}</h3>
                                            <span className={cn('text-xs font-medium', w.activo ? 'text-green-400' : 'text-slate-500')}>
                                                {w.activo ? '● Activo' : '○ Inactivo'}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 font-mono truncate mt-0.5">{w.url}</p>
                                        {w.descripcion && <p className="text-xs text-slate-400 mt-1">{w.descripcion}</p>}
                                        {tr !== undefined && tr !== null && (
                                            <div className={cn('inline-flex items-center gap-1.5 mt-2 text-xs px-2 py-0.5 rounded',
                                                tr.ok ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300')}>
                                                {tr.ok ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                                HTTP {tr.status}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <Button size="sm" variant="outline" disabled={isPending}
                                        className="border-white/10 text-slate-300 hover:bg-white/5 gap-1.5"
                                        onClick={() => handleQuickTest(w.id)}>
                                        <TestTube className="w-3.5 h-3.5" />Ping
                                    </Button>
                                    <Button size="sm" variant="outline" disabled={isPending}
                                        className="border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 gap-1.5"
                                        onClick={() => setTestWebhookData(w)}>
                                        <Send className="w-3.5 h-3.5" />Probar
                                    </Button>
                                    <Button size="sm" variant="outline" className="border-white/10 text-slate-300 hover:bg-white/5"
                                        onClick={() => { setEditWebhook(w); setFormOpen(true) }}>
                                        <Pencil className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                                        onClick={() => setDeleteId(w.id)}>
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            <WebhookFormModal open={formOpen} onClose={() => { setFormOpen(false); setEditWebhook(undefined) }} webhook={editWebhook} />

            <WebhookTestModal open={!!testWebhookData} onClose={() => setTestWebhookData(null)} webhook={testWebhookData} />

            <AlertDialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null) }}>
                <AlertDialogContent className="bg-slate-900 border-white/10 text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar webhook?</AlertDialogTitle>
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

