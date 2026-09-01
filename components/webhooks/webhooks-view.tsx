'use client'

import { useState, useTransition, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { WebhookSchema, WebhookFormData } from '@/lib/validations/schemas'
import {
    createWebhook, updateWebhook, deleteWebhook, testWebhook,
    previsualizarPruebaWebhook,
} from '@/lib/actions/webhooks'
import type { PruebaWebhook, ResultadoPruebaWebhook } from '@/lib/webhooks/payload-prueba'
import { Webhook } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, Pencil, Trash2, Loader2, Webhook as WebhookIcon, CheckCircle, XCircle, TestTube, Send, Eye, EyeOff, AlertTriangle, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WebhooksViewProps { webhooks: Webhook[] }

const EVENTO_OPTIONS: { value: 'cobranza' | 'ticket'; label: string; help: string }[] = [
    { value: 'cobranza', label: 'Cobranza', help: 'Recordatorios automáticos de deuda enviados por el cron (preventivo, mora, recuperación, referencias).' },
    { value: 'ticket', label: 'Boletos', help: 'Envío del boleto de sorteo al cliente por WhatsApp cuando se emite o reenvía un ticket.' },
]

function WebhookFormModal({ open, onClose, webhook }: { open: boolean; onClose: () => void; webhook?: Webhook }) {
    const [isPending, startTransition] = useTransition()
    const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<WebhookFormData>({
        resolver: zodResolver(WebhookSchema),
        defaultValues: webhook
            ? { nombre: webhook.nombre, url: webhook.url, descripcion: webhook.descripcion ?? '', activo: webhook.activo, evento: webhook.evento }
            : { activo: true, evento: 'cobranza' },
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
                    evento: webhook.evento,
                })
            } else {
                reset({
                    nombre: '',
                    url: '',
                    descripcion: '',
                    activo: true,
                    evento: 'cobranza',
                })
            }
        }
    }, [open, webhook, reset])

    const eventoActual = watch('evento')

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
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Evento *</Label>
                        <Select
                            value={eventoActual}
                            onValueChange={v => setValue('evento', v as WebhookFormData['evento'])}
                        >
                            <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                                <SelectValue placeholder="Seleccionar evento..." />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-white/10 text-white">
                                {EVENTO_OPTIONS.map(e => (
                                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-slate-500">
                            {EVENTO_OPTIONS.find(e => e.value === eventoActual)?.help}
                        </p>
                        {errors.evento && <p className="text-xs text-red-400">{errors.evento.message}</p>}
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

/** «48.213 caracteres · ~35 KB»: el tamaño importa, n8n y WhatsApp tienen topes. */
function formatearTamano(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function WebhookTestModal({ open, onClose, webhook }: { open: boolean; onClose: () => void; webhook: Webhook | null }) {
    const [isPending, startTransition] = useTransition()
    const [result, setResult] = useState<ResultadoPruebaWebhook | null>(null)
    const [preview, setPreview] = useState<PruebaWebhook | null>(null)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [cargando, setCargando] = useState(false)
    const [showPayload, setShowPayload] = useState(true)

    // El payload lo arma el SERVIDOR y se pide al abrir. Antes había aquí
    // una copia escrita a mano que ni siquiera coincidía con la que enviaba
    // la Server Action: la pantalla enseñaba `recordatorio_cobranza` y el
    // POST llevaba `test_conexion`. Ahora es el mismo objeto, con el base64
    // del PDF sustituido por su tamaño para no colgar la pestaña.
    useEffect(() => {
        if (!open || !webhook) {
            setPreview(null); setPreviewError(null); setResult(null)
            return
        }
        let vigente = true
        setCargando(true)
        setPreviewError(null)
        previsualizarPruebaWebhook(webhook.id)
            .then(p => { if (vigente) setPreview(p) })
            .catch((e: unknown) => {
                if (vigente) setPreviewError(e instanceof Error ? e.message : 'No se pudo armar el payload de prueba')
            })
            .finally(() => { if (vigente) setCargando(false) })
        return () => { vigente = false }
    }, [open, webhook])

    const vista: PruebaWebhook | null = result ?? preview
    const esBoletos = webhook?.evento === 'ticket'

    const handleSendTest = () => {
        if (!webhook) return
        startTransition(async () => {
            try {
                const res = await testWebhook(webhook.id)
                setResult(res)
                if (res.ok) toast.success(`Prueba enviada — HTTP ${res.status}`)
                else toast.error(`Respuesta HTTP ${res.status}`)
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
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-white">{webhook?.nombre}</p>
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium',
                                esBoletos ? 'bg-indigo-500/20 text-indigo-300' : 'bg-sky-500/20 text-sky-300')}>
                                {esBoletos ? 'Boletos' : 'Cobranza'}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 font-mono truncate">{webhook?.url}</p>
                        <p className="text-xs text-slate-400">
                            {esBoletos
                                ? 'Se envía un boleto ficticio completo: mensaje, sorteo y el PDF en base64.'
                                : 'Se envía un recordatorio de cobranza ficticio, con la misma forma que el real.'}
                        </p>
                    </div>

                    {/* Avisos: en qué se diferencia esta prueba de un envío real */}
                    {vista && vista.avisos.length > 0 && (
                        <ul className="space-y-1.5">
                            {vista.avisos.map((a, i) => (
                                <li key={i} className="flex gap-2 text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                                    <span>{a}</span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Adjunto */}
                    {vista?.adjunto && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-300 bg-slate-800/50 border border-white/5 rounded-lg p-2.5">
                            <Paperclip className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            <span className="font-mono truncate">{vista.adjunto.nombre}</span>
                            <span className="text-slate-500">
                                {formatearTamano(vista.adjunto.bytes_pdf)} · {vista.adjunto.caracteres_base64.toLocaleString('es-DO')} caracteres en base64
                            </span>
                        </div>
                    )}

                    {/* Payload */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                                {result ? 'Payload enviado' : 'Payload que se enviará'} (datos ficticios)
                            </p>
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
                                {cargando && 'Armando el payload de prueba...'}
                                {!cargando && previewError}
                                {!cargando && !previewError && vista && JSON.stringify(vista.payload, null, 2)}
                            </pre>
                        )}
                    </div>

                    {/* Resultado */}
                    {result && (
                        <div className={cn(
                            'p-3 rounded-xl border space-y-2',
                            result.ok ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'
                        )}>
                            <div className="flex items-center gap-3">
                                {result.ok
                                    ? <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                                    : <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
                                <div>
                                    <p className={cn('text-sm font-semibold', result.ok ? 'text-green-300' : 'text-red-300')}>
                                        {result.ok ? 'El webhook aceptó el envío' : 'El webhook no aceptó el envío'}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        Código HTTP: <span className="font-mono font-semibold">{result.status || 'sin respuesta'}</span>
                                    </p>
                                </div>
                            </div>
                            {result.body && (
                                <pre className="text-[11px] text-slate-400 bg-slate-950/60 rounded-lg p-2.5 overflow-auto max-h-32 font-mono whitespace-pre-wrap">
                                    {result.body}
                                </pre>
                            )}
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" className="border-white/10 text-slate-300" onClick={() => { setResult(null); onClose() }}>
                            Cerrar
                        </Button>
                        <Button
                            type="button"
                            disabled={isPending || cargando || !!previewError}
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
                setTestResult(prev => ({ ...prev, [id]: { ok: result.ok, status: result.status } }))
                if (result.ok) toast.success(`Prueba enviada — HTTP ${result.status}`)
                else toast.error(`El webhook respondió HTTP ${result.status || 'nada'}`)
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
                                            <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
                                                w.evento === 'ticket' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-sky-500/20 text-sky-300')}>
                                                {w.evento === 'ticket' ? 'Boletos' : 'Cobranza'}
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

