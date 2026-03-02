import { createClient } from '@/lib/supabase/server'
import { PlantillasView } from '@/components/plantillas/plantillas-view'
import { FileText } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

export default async function PlantillasPage() {
    const supabase = await createClient()
    const { data: plantillas } = await supabase
        .from('plantillas_mensaje')
        .select('*')
        .order('etapa')

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <PageHeader title="Plantillas de Mensaje" description="Mensajes automáticos por etapa de cobranza" icon={FileText} />
            <PlantillasView plantillas={plantillas ?? []} />
        </div>
    )
}

