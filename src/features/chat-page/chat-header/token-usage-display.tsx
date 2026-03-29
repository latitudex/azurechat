"use client";
import { FC } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { useChat } from "../chat-store";
import { Coins } from "lucide-react";

export const TokenUsageDisplay: FC = () => {
  const { lastUsageData } = useChat();

  if (!lastUsageData) return null;

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toString();
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return "--";
    if (cost < 0.01) return "< $0.01";
    return `$${cost.toFixed(2)}`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 px-1.5 py-1 rounded hover:bg-accent/50 active:bg-accent transition-colors cursor-pointer"
          aria-label={`Thread token usage: ${formatTokens(lastUsageData.threadTotalTokens)}`}
        >
          <Coins size={14} />
          <span>{formatTokens(lastUsageData.threadTotalTokens)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-52">
        <DropdownMenuLabel className="font-normal">
          <div className="text-xs space-y-1">
            <p className="text-sm font-medium">Thread Usage</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <span className="text-muted-foreground">Total tokens</span>
              <span className="text-right">
                {lastUsageData.threadTotalTokens.toLocaleString()}
              </span>
              <span className="text-muted-foreground">Last input</span>
              <span className="text-right">
                {lastUsageData.inputTokens.toLocaleString()}
              </span>
              <span className="text-muted-foreground">Last output</span>
              <span className="text-right">
                {lastUsageData.outputTokens.toLocaleString()}
              </span>
              {lastUsageData.cachedTokens > 0 && (
                <>
                  <span className="text-muted-foreground">Cached</span>
                  <span className="text-right">
                    {lastUsageData.cachedTokens.toLocaleString()}
                  </span>
                </>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="font-normal">
          <div className="text-xs grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-muted-foreground">Last request</span>
            <span className="text-right font-medium">
              {formatCost(lastUsageData.costUsd)}
            </span>
            <span className="text-muted-foreground">Thread total</span>
            <span className="text-right font-medium">
              {formatCost(lastUsageData.threadTotalCostUsd)}
            </span>
          </div>
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
