import { createClient } from '@/lib/supabase/server'
import { WebhooksView } from '@/components/webhooks/webhooks-view'
import { Webhook } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

export default async function WebhooksPage() {
    const supabase = await createClient()
    const { data: webhooks } = await supabase
        .from('webhooks')
        .select('*')
        .order('created_at', { ascending: false })

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <PageHeader title="Webhooks" description="Configuración de destinos de envío automático (n8n)" icon={Webhook} />
            <WebhooksView webhooks={webhooks ?? []} />
        </div>
    )
}

