"use client"

import { AlertCircle, Info } from "lucide-react"

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/features/ui/toast"
import { useToast } from "@/features/ui/use-toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        // Only two toast variants exist (default/destructive) but three intents
        // (success/warning/info all ride on "default"), so the non-error icon
        // stays neutral (Info) — a green check would mislabel warnings.
        const Icon = props.variant === "destructive" ? AlertCircle : Info

        return (
          <Toast key={id} {...props} className="z-[999]">
            <Icon
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
