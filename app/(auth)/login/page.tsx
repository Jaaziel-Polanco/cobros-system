'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { LoginSchema, LoginFormData } from '@/lib/validations/schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, TrendingUp, Lock, Mail, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [checking, setChecking] = useState(true)   // Verificando hash en URL
    const [showPwd, setShowPwd] = useState(false)

    const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
        resolver: zodResolver(LoginSchema)
    })

    // ── Detectar invite/recovery en el hash de la URL ──────────
    useEffect(() => {
        const hash = window.location.hash
        if (hash && hash.includes('access_token')) {
            const params = new URLSearchParams(hash.substring(1))
            const type = params.get('type')

            // Para invitaciones y recuperación de contraseña → redirigir a set-password
            // La página set-password leerá el hash directamente
            if (type === 'invite' || type === 'recovery') {
                router.replace(`/set-password${hash}`)
                return
            }
        }
        setChecking(false)
    }, [router])

    const onSubmit = async (data: LoginFormData) => {
        setLoading(true)
        try {
            const supabase = createClient()
            const { error } = await supabase.auth.signInWithPassword({
                email: data.email,
                password: data.password,
            })
            if (error) throw error
            router.push('/dashboard')
            router.refresh()
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Error al iniciar sesión'
            // Traducir mensajes de Supabase
            if (msg.includes('Invalid login credentials')) {
                toast.error('Correo o contraseña incorrectos')
            } else if (msg.includes('Email not confirmed')) {
                toast.error('Debes confirmar tu correo antes de ingresar')
            } else {
                toast.error(msg)
            }
        } finally {
            setLoading(false)
        }
    }

    // Mientras verificamos el hash, no mostrar el formulario (evita flash)
    if (checking) {
        return (
            <div className="min-h-screen flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #061020 0%, #0a1628 40%, #0c2040 70%, #051018 100%)' }}>
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#007EC6' }} />
            </div>
        )
    }

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #061020 0%, #0a1628 40%, #0c2040 70%, #051018 100%)' }}>

            {/* Animated background blobs */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-32 -right-32 w-125 h-125 rounded-full opacity-20 blur-3xl"
                    style={{ background: 'radial-gradient(circle, #007EC6, transparent)' }} />
                <div className="absolute -bottom-32 -left-32 w-125 h-125 rounded-full opacity-15 blur-3xl"
                    style={{ background: 'radial-gradient(circle, #0096E8, transparent)' }} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-175 h-175 rounded-full opacity-5 blur-3xl"
                    style={{ background: 'radial-gradient(circle, #007EC6, transparent)' }} />
                <div className="absolute inset-0 opacity-5"
                    style={{
                        backgroundImage: 'linear-gradient(rgba(0,126,198,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(0,126,198,0.5) 1px, transparent 1px)',
                        backgroundSize: '64px 64px',
                    }} />
            </div>

            <div className="relative w-full max-w-md px-6 sm:px-0">
                {/* Logo / Brand */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-5 shadow-2xl relative"
                        style={{
                            background: 'linear-gradient(135deg, #007EC6 0%, #0096E8 60%, #005f96 100%)',
                            boxShadow: '0 0 40px rgba(0,126,198,0.5), 0 20px 40px rgba(0,0,0,0.3)',
                        }}>
                        <TrendingUp className="w-10 h-10 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Inversiones Cordero</h1>
                    <p className="mt-2 text-sm font-medium tracking-widest uppercase" style={{ color: '#5bbfed' }}>
                        Plataforma de Gestión de Cobranza
                    </p>
                </div>

                {/* Card */}
                <div className="rounded-2xl p-8 shadow-2xl"
                    style={{
                        background: 'rgba(12,29,56,0.85)',
                        backdropFilter: 'blur(20px)',
                        border: '1px solid rgba(0,126,198,0.2)',
                        boxShadow: '0 0 0 1px rgba(0,126,198,0.1), 0 32px 64px rgba(0,0,0,0.4)',
                    }}>
                    <div className="mb-6">
                        <h2 className="text-xl font-bold text-white">Iniciar sesión</h2>
                        <p className="text-sm text-slate-400 mt-1">Ingresa tus credenciales para acceder al sistema</p>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                        <div className="space-y-1.5">
                            <Label htmlFor="email" className="text-slate-300 text-sm font-medium flex items-center gap-1.5">
                                <Mail className="w-3.5 h-3.5" style={{ color: '#007EC6' }} />
                                Correo electrónico
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="nombre@empresa.com"
                                autoComplete="email"
                                className="text-white placeholder:text-slate-500 h-11 transition-all duration-150"
                                style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: errors.email ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(0,126,198,0.2)',
                                }}
                                {...register('email')}
                            />
                            {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>}
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="password" className="text-slate-300 text-sm font-medium flex items-center gap-1.5">
                                <Lock className="w-3.5 h-3.5" style={{ color: '#007EC6' }} />
                                Contraseña
                            </Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={showPwd ? 'text' : 'password'}
                                    placeholder="••••••••"
                                    autoComplete="current-password"
                                    className="text-white placeholder:text-slate-500 h-11 pr-10"
                                    style={{
                                        background: 'rgba(255,255,255,0.05)',
                                        border: errors.password ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(0,126,198,0.2)',
                                    }}
                                    {...register('password')}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPwd(!showPwd)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                >
                                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {errors.password && <p className="text-xs text-red-400 mt-1">{errors.password.message}</p>}
                        </div>

                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full text-white border-0 h-12 font-bold text-sm tracking-wide transition-all duration-200 shadow-lg mt-2"
                            style={{
                                background: loading
                                    ? 'rgba(0,126,198,0.6)'
                                    : 'linear-gradient(135deg, #007EC6 0%, #0096E8 50%, #005f96 100%)',
                                boxShadow: '0 8px 24px rgba(0,126,198,0.35)',
                            }}
                        >
                            {loading ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Ingresando...</>
                            ) : 'Ingresar al sistema →'}
                        </Button>
                    </form>
                </div>

                <p className="text-center text-xs text-slate-600 mt-6">
                    © {new Date().getFullYear()} Inversiones Cordero. Todos los derechos reservados.
                </p>
            </div>
        </div>
    )
}
