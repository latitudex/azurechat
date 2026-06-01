"use client";

import { AlertTriangle } from "lucide-react";
import { FC } from "react";

import { Button } from "@/features/ui/button";
import { cn } from "@/ui/lib";

interface DisplayErrorProps {
  errors: Array<{ message: string }>;
  /** Heading shown above the error message(s). */
  title?: string;
  /** When provided, renders a primary recovery action. */
  onRetry?: () => void;
  /** Label for the recovery action. */
  retryLabel?: string;
}

export const DisplayError: FC<DisplayErrorProps> = ({
  errors,
  title = "Something went wrong",
  onRetry,
  retryLabel = "Try again",
}) => {
  const hasMultiple = errors.length > 1;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "flex h-full w-full min-h-[60vh] flex-col items-center justify-center",
        "px-5 py-10 text-center sm:px-8"
      )}
    >
      <div className="flex w-full max-w-md flex-col items-center gap-5">
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20"
        >
          <AlertTriangle className="size-7" strokeWidth={2} />
        </span>

        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>

          {hasMultiple ? (
            <ul className="flex flex-col gap-1.5 text-left text-sm leading-relaxed text-muted-foreground">
              {errors.map((err, index) => (
                <li key={index} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1 shrink-0 rounded-full bg-destructive/60"
                  />
                  <span className="break-words">{err.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground break-words">
              {errors[0]?.message ??
                "An unexpected error occurred. Please try again."}
            </p>
          )}
        </div>

        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="mt-1"
          >
            {retryLabel}
          </Button>
        )}
      </div>
    </div>
  );
};
