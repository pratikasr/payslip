import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Square typewriter keys on paper (docs/DESIGN.md section 17): a 2px ink border, Courier Prime
// bold. The primary is ink-filled with white type, secondary and outline are the same key
// outlined, destructive is outlined in the stamp's red; ghost stays borderless for icon buttons.
// On touch screens (pointer: coarse) every size gets an invisible hit area of at least 44px
// (Apple's minimum) around it, so a 24px copy icon or a 32px pill is easy to tap without
// changing how it looks.
const buttonVariants = cva(
  "group/button relative pointer-coarse:after:absolute pointer-coarse:after:content-[''] inline-flex shrink-0 items-center justify-center rounded-none border-2 border-transparent bg-clip-padding font-type text-[0.875rem] font-bold tracking-[0.01em] whitespace-nowrap transition-colors outline-hidden focus-visible:outline-solid select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Disabled, the primary turns grey like every other disabled button (never a washed-out ink).
        default:
          "border-primary bg-primary text-primary-foreground hover:border-[color-mix(in_oklch,var(--primary),var(--background)_18%)] hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_18%)] disabled:border-border disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100",
        outline: "border-foreground bg-transparent text-foreground hover:bg-muted aria-expanded:bg-muted",
        secondary: "border-foreground bg-transparent text-foreground hover:bg-muted aria-expanded:bg-muted",
        ghost:
          "border-transparent text-strong hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive: "border-destructive bg-transparent text-destructive hover:bg-danger-bg",
        link: "border-0 font-type text-link underline decoration-1 underline-offset-4 hover:decoration-2",
      },
      size: {
        default:
          "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 pointer-coarse:after:-inset-x-0 pointer-coarse:after:-inset-y-1",
        xs: "h-6 gap-1 px-2.5 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-3 pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-2.5",
        sm: "h-8 gap-1.5 px-3.5 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-3.5 pointer-coarse:after:-inset-x-0 pointer-coarse:after:-inset-y-1.5",
        lg: "h-10 gap-2 px-5 text-[0.9375rem] pointer-coarse:after:-inset-x-0 pointer-coarse:after:-inset-y-0.5",
        icon: "size-9 pointer-coarse:after:-inset-1",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3 pointer-coarse:after:-inset-2.5",
        "icon-sm": "size-8 pointer-coarse:after:-inset-1.5",
        "icon-lg": "size-10 pointer-coarse:after:-inset-0.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
