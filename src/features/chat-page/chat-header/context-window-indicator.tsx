"use client";
import { FC } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { useChat } from "../chat-store";

export const ContextWindowIndicator: FC = () => {
  const { lastUsageData } = useChat();

  // Only show after a live request (not on historical load where inputTokens is 0)
  if (!lastUsageData || !lastUsageData.contextWindowSize || lastUsageData.inputTokens === 0) return null;

  const percent = Math.min(lastUsageData.contextUsagePercent, 100);
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  const color =
    percent > 80
      ? "text-red-500"
      : percent > 50
        ? "text-yellow-500"
        : "text-muted-foreground";

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toString();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center shrink-0 p-1 rounded hover:bg-accent/50 active:bg-accent transition-colors cursor-pointer ${color}`}
          aria-label={`${percent.toFixed(0)}% of context window used`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <circle
              cx="12"
              cy="12"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              opacity="0.2"
            />
            <circle
              cx="12"
              cy="12"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              transform="rotate(-90 12 12)"
              className="transition-all duration-500"
            />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-48">
        <DropdownMenuLabel className="font-normal">
          <div className="text-xs space-y-1">
            <p className="text-sm font-medium">Context Window</p>
            <p>
              {formatTokens(lastUsageData.inputTokens)} /{" "}
              {formatTokens(lastUsageData.contextWindowSize)} tokens
            </p>
            <p>{percent.toFixed(1)}% used</p>
          </div>
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
