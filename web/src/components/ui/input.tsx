import * as React from "react"
import { cn } from "cn"

/** Typewriter text on a ruled baseline, the way a form is filled in (docs/DESIGN.md section 17). */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-none border-0 border-b border-input bg-transparent px-1 py-1 font-type text-[1.0625rem] transition-colors outline-hidden file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-[0.8125rem] file:font-bold file:text-foreground placeholder:text-muted-foreground hover:border-foreground focus-visible:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-b-2 aria-invalid:border-destructive md:text-[0.9375rem]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
