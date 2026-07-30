'use client'

import { useTransition, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
    ConfiguracionTicketSchema,
    type ConfiguracionTicketFormData,
} from '@/lib/validations/tickets'
import { actualizarConfiguracionTicket } from '@/lib/actions/configuracion-ticket'
import { enviarBoletoDePrueba } from '@/lib/actions/tickets'
import type { ConfiguracionTicket } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, AlertTriangle } from 'lucide-react'

interface ConfiguracionTicketViewProps {
    configuracion: ConfiguracionTicket
    /** Base de `APP_PUBLIC_URL` leída en el Server Component. Nunca se lee
     *  `process.env` aquí porque este es un componente de cliente. */
    urlPublicaBase: string
}

export function ConfiguracionTicketView({ configuracion, urlPublicaBase }: ConfiguracionTicketViewProps) {
    const [isPending, startTransition] = useTransition()
    const [probando, startPrueba] = useTransition()
    const [resultado, setResultado] = useState<{ ok: boolean; estado: number; cuerpo: string } | null>(null)

    const {
        register, handleSubmit, setValue, watch, formState: { errors },
    } = useForm<ConfiguracionTicketFormData>({
        resolver: zodResolver(ConfiguracionTicketSchema),
        defaultValues: {
            nombre_comercial: configuracion.nombre_comercial,
            rnc: configuracion.rnc ?? '',
            direccion: configuracion.direccion ?? '',
            telefono: configuracion.telefono ?? '',
            logo_url: configuracion.logo_url ?? '',
            texto_legal: configuracion.texto_legal ?? '',
            url_terminos: configuracion.url_terminos ?? '',
            prefijo_numeracion: configuracion.prefijo_numeracion,
            pie_impresion: configuracion.pie_impresion ?? '',
            modo_adjunto: configuracion.modo_adjunto,
        },
    })

    const modoAdjunto = watch('modo_adjunto')
    const mostrarAvisoUrl = modoAdjunto === 'url' || modoAdjunto === 'ambos'

    const onSubmit = (data: ConfiguracionTicketFormData) => {
        startTransition(async () => {
            try {
                await actualizarConfiguracionTicket(data)
                toast.success('Configuración guardada')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al guardar')
            }
        })
    }

    const probar = () => {
        startPrueba(async () => {
            try {
                setResultado(await enviarBoletoDePrueba())
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
            <div className="rounded-2xl border border-white/5 bg-slate-800/50 p-5 space-y-4">
                <h2 className="text-sm font-semibold text-white">Datos del negocio</h2>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Nombre comercial *</Label>
                        <Input className="bg-slate-800 border-white/10 text-white" {...register('nombre_comercial')} />
                        {errors.nombre_comercial && (
                            <p className="text-xs text-red-400">{errors.nombre_comercial.message}</p>
                        )}
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">RNC</Label>
                        <Input className="bg-slate-800 border-white/10 text-white" {...register('rnc')} />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Dirección</Label>
                        <Input className="bg-slate-800 border-white/10 text-white" {...register('direccion')} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Teléfono</Label>
                        <Input placeholder="809-000-0000" className="bg-slate-800 border-white/10 text-white" {...register('telefono')} />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <Label className="text-slate-300">Logo (URL)</Label>
                    <Input className="bg-slate-800 border-white/10 text-white" {...register('logo_url')} />
                    {errors.logo_url && <p className="text-xs text-red-400">{errors.logo_url.message}</p>}
                </div>

                <div className="space-y-1.5">
                    <Label className="text-slate-300">Texto legal</Label>
                    <Textarea className="bg-slate-800 border-white/10 text-white resize-none" rows={2} {...register('texto_legal')} />
                    {errors.texto_legal && <p className="text-xs text-red-400">{errors.texto_legal.message}</p>}
                </div>

                <div className="space-y-1.5">
                    <Label className="text-slate-300">URL de términos y condiciones</Label>
                    <Input className="bg-slate-800 border-white/10 text-white" {...register('url_terminos')} />
                    {errors.url_terminos && <p className="text-xs text-red-400">{errors.url_terminos.message}</p>}
                </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-slate-800/50 p-5 space-y-4">
                <h2 className="text-sm font-semibold text-white">Numeración e impresión</h2>

                <div className="space-y-1.5">
                    <Label className="text-slate-300">Prefijo de numeración *</Label>
                    <Input placeholder="TCK" className="bg-slate-800 border-white/10 text-white uppercase" {...register('prefijo_numeracion')} />
                    {errors.prefijo_numeracion && (
                        <p className="text-xs text-red-400">{errors.prefijo_numeracion.message}</p>
                    )}
                </div>

                <div className="space-y-1.5">
                    <Label className="text-slate-300">Pie de impresión</Label>
                    <Textarea className="bg-slate-800 border-white/10 text-white resize-none" rows={2} {...register('pie_impresion')} />
                    {errors.pie_impresion && <p className="text-xs text-red-400">{errors.pie_impresion.message}</p>}
                </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-slate-800/50 p-5 space-y-4">
                <h2 className="text-sm font-semibold text-white">Envío por WhatsApp</h2>

                <div className="space-y-1.5">
                    <Label className="text-slate-300">Modo de adjunto</Label>
                    <Select
                        defaultValue={configuracion.modo_adjunto}
                        onValueChange={v => setValue('modo_adjunto', v as ConfiguracionTicketFormData['modo_adjunto'])}
                    >
                        <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                            <SelectValue placeholder="Modo de adjunto" />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-white/10 text-white">
                            <SelectItem value="base64">base64</SelectItem>
                            <SelectItem value="url">url</SelectItem>
                            <SelectItem value="ambos">ambos</SelectItem>
                            <SelectItem value="ninguno">ninguno</SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="text-xs text-slate-500 space-y-1 mt-1.5">
                        <p><span className="font-semibold text-slate-400">base64</span> — el PDF viaja dentro del mensaje al webhook. Funciona sin exponer el servidor a internet. Es lo recomendado.</p>
                        <p><span className="font-semibold text-slate-400">url</span> — solo se envía el enlace. Requiere que este servidor sea alcanzable desde internet.</p>
                        <p><span className="font-semibold text-slate-400">ambos</span> — envía las dos cosas, útil para depurar.</p>
                        <p><span className="font-semibold text-slate-400">ninguno</span> — solo texto, sin adjunto.</p>
                    </div>

                    {mostrarAvisoUrl && (
                        <div className="mt-3 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                            <div className="text-xs text-amber-300">
                                <p>
                                    La URL base que se usará realmente es{' '}
                                    <span className="font-mono text-amber-200">{urlPublicaBase}</span>.
                                </p>
                                <p className="mt-1 text-amber-300/80">
                                    Debe ser alcanzable desde internet para que el proveedor de WhatsApp pueda
                                    descargar el PDF; si no está configurada, el enlace apuntará a localhost y
                                    llegará roto al cliente.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-3">
                <Button type="submit" disabled={isPending}
                    className="text-white" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)" }}>
                    {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar cambios'}
                </Button>
                <Button type="button" variant="outline" disabled={probando}
                    onClick={probar}
                    className="border-white/10 text-slate-300 hover:bg-white/5">
                    {probando ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Enviando...</> : 'Enviar boleto de prueba'}
                </Button>
            </div>

            {resultado && (
                <div className="rounded-2xl border border-white/5 bg-slate-800/50 p-5 space-y-2">
                    <p className="text-sm font-semibold text-white">
                        Respuesta del webhook:{' '}
                        <span className={resultado.ok ? 'text-green-400' : 'text-red-400'}>
                            {resultado.estado || 'sin respuesta'}
                        </span>
                    </p>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-300 whitespace-pre-wrap break-all">
                        {resultado.cuerpo || '(cuerpo vacío)'}
                    </pre>
                </div>
            )}
        </form>
    )
}
