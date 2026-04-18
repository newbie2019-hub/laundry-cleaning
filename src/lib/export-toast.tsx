import { Check } from 'lucide-react'
import { toast } from 'sonner'

const successToastClassNames = {
  toast: '!bg-white !border !border-gray-200 !text-gray-900 !shadow-lg',
  title: '!text-gray-900 !text-sm !font-medium',
  content: '!items-start !gap-3',
  icon: '!self-start !mt-0.5 !bg-transparent !border-0 !size-auto',
}

export function toastBrowserExportSuccess() {
  toast.success('Export successful. Please check your downloads folder.', {
    icon: <Check aria-hidden className="h-5 w-5 shrink-0 text-emerald-600" strokeWidth={2.25} />,
    classNames: successToastClassNames,
  })
}

export function toastBrowserExportFailed(message: string) {
  toast.error('Export failed', { description: message })
}
