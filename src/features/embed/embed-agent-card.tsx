"use client";

import { useRouter } from "next/navigation";
import { type FC } from "react";
import { PersonaModel } from "@/features/persona-page/persona-services/models";
import { Avatar, AvatarImage } from "@/features/ui/avatar";
import { Button } from "@/features/ui/button";

/**
 * Slim agent start card for the embed landing. Shows the persona name,
 * description and a single primary "Start chat" CTA that navigates the iframe
 * to the embed chat-creation route, which forwards to /embed/chat/[id].
 */
export const EmbedAgentCard: FC<{ persona: PersonaModel }> = ({ persona }) => {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center h-full w-full gap-4 p-6 text-center overflow-auto">
      <Avatar className="h-16 w-16">
        <AvatarImage src="/ai-icon.png" />
      </Avatar>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{persona.name}</h1>
        <p className="text-sm text-muted-foreground max-w-md line-clamp-4">
          {persona.description}
        </p>
      </div>
      <Button
        className="mt-2"
        onClick={() => router.push(`/embed/agent/${persona.id}/chat`)}
      >
        Start chat
      </Button>
    </div>
  );
};
