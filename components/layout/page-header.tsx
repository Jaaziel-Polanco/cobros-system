import { LucideIcon } from 'lucide-react'

interface PageHeaderProps {
    title: string
    description?: string
    icon?: LucideIcon
    iconColor?: string
}

export function PageHeader({ title, description, icon: Icon }: PageHeaderProps) {
    return (
        <div className="flex items-center gap-4">
            {Icon && (
                <div
                    className="w-10 h-10 rounded-xl items-center justify-center shrink-0 flex max-sm:hidden"
                    style={{
                        background: 'rgba(0,126,198,0.1)',
                        border: '1px solid rgba(0,126,198,0.2)',
                    }}
                >
                    <Icon className="w-5 h-5" style={{ color: '#007EC6' }} />
                </div>
            )}
            <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
                {description && <p className="text-slate-400 text-sm mt-0.5">{description}</p>}
            </div>
        </div>
    )
}
