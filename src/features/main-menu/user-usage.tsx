"use client";

import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Coins } from "lucide-react";

interface UsageData {
  daily: {
    totalTokens: number;
    totalCostUsd: number;
    models: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requestCount: number }>;
  };
  weekly: {
    totalTokens: number;
    totalCostUsd: number;
  };
}

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

function getDailyResetLabel(): string {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diffMs = midnight.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours > 0) return `resets in ${hours}h ${minutes}m`;
  return `resets in ${minutes}m`;
}

function getWeeklyResetLabel(): string {
  const now = new Date();
  // Reset on Friday 17:00
  const friday = new Date(now);
  const dayOfWeek = now.getDay(); // 0=Sun, 5=Fri
  let daysUntilFri = (5 - dayOfWeek + 7) % 7;
  // If it's Friday but past 17:00, next Friday
  if (daysUntilFri === 0 && now.getHours() >= 17) daysUntilFri = 7;
  friday.setDate(now.getDate() + daysUntilFri);
  friday.setHours(17, 0, 0, 0);

  const diffMs = friday.getTime() - now.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);

  if (days > 1) return `resets Fri 17:00 (${days}d)`;
  if (days === 1) return `resets Fri 17:00 (1d ${hours}h)`;
  return `resets in ${hours}h`;
}

export const UserUsage = () => {
  const [usage, setUsage] = useState<UsageData | null>(null);

  const fetchUsage = async () => {
    try {
      const res = await fetch("/api/usage");
      if (res.ok) {
        setUsage(await res.json());
      }
    } catch {
      // Silently fail - usage display is non-critical
    }
  };

  useEffect(() => {
    fetchUsage();
    const interval = setInterval(fetchUsage, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!usage || (usage.daily.totalTokens === 0 && usage.weekly.totalTokens === 0)) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground px-1 py-1 rounded hover:bg-accent/50 active:bg-accent transition-colors cursor-pointer"
          aria-label={`Today's token usage: ${formatTokens(usage.daily.totalTokens)}`}
        >
          <Coins size={10} />
          <span>{formatTokens(usage.daily.totalTokens)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" className="w-56" align="end">
        <DropdownMenuLabel className="font-normal">
          <div className="text-xs space-y-1">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium">Today</p>
              <span className="text-[10px] text-muted-foreground">{getDailyResetLabel()}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <span className="text-muted-foreground">Tokens</span>
              <span className="text-right">{usage.daily.totalTokens.toLocaleString()}</span>
              <span className="text-muted-foreground">Est. cost</span>
              <span className="text-right font-medium">{formatCost(usage.daily.totalCostUsd)}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        {usage.weekly.totalTokens > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal">
              <div className="text-xs space-y-1">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium">This Week</p>
                  <span className="text-[10px] text-muted-foreground">{getWeeklyResetLabel()}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <span className="text-muted-foreground">Tokens</span>
                  <span className="text-right">{usage.weekly.totalTokens.toLocaleString()}</span>
                  <span className="text-muted-foreground">Est. cost</span>
                  <span className="text-right font-medium">{formatCost(usage.weekly.totalCostUsd)}</span>
                </div>
              </div>
            </DropdownMenuLabel>
          </>
        )}
        {Object.keys(usage.daily.models).length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal">
              <div className="text-xs space-y-1">
                <p className="text-sm font-medium">By Model (today)</p>
                {Object.entries(usage.daily.models).map(([model, data]) => (
                  <div key={model} className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <span className="text-muted-foreground truncate">{model}</span>
                    <span className="text-right">{formatCost(data.costUsd)}</span>
                  </div>
                ))}
              </div>
            </DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
