import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-none border border-input bg-transparent bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(1.6em_-_1px),var(--hairline)_calc(1.6em_-_1px),var(--hairline)_1.6em)] bg-local px-2 py-[0.3em] font-type text-[1.0625rem] leading-[1.6] transition-colors outline-hidden placeholder:text-muted-foreground hover:border-foreground focus-visible:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-[0.9375rem]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
