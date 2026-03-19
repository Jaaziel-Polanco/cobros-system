'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, Loader2 } from 'lucide-react'

function LoginForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(searchParams.get('error'))
    const [loading, setLoading] = useState(false)

    const nextPath = searchParams.get('next') || '/dashboard'

    const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setError(null)
        setLoading(true)

        try {
            const supabase = createClient()
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password,
            })

            if (signInError) {
                setError(signInError.message)
                return
            }

            router.push(nextPath)
            router.refresh()
        } catch {
            setError('No se pudo iniciar sesión. Intenta nuevamente.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
            <Card className="w-full max-w-md bg-slate-900 border-white/10 text-white">
                <CardHeader>
                    <CardTitle className="text-xl">Iniciar sesión</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={onSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="email">Correo</Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="correo@empresa.com"
                                className="bg-slate-800 border-white/10 text-white"
                                required
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="password">Contraseña</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="********"
                                className="bg-slate-800 border-white/10 text-white"
                                required
                            />
                        </div>

                        {error && (
                            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <Button type="submit" disabled={loading} className="w-full">
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Entrar'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </main>
    )
}

export default function LoginPage() {
    return (
        <Suspense fallback={<main className="min-h-screen bg-slate-950" />}>
            <LoginForm />
        </Suspense>
    )
}
