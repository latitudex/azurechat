"use client";

import { useParams, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { showError } from "@/features/globals/global-message-store";
import { PersonaModel } from "@/features/persona-page/persona-services/models";
import {
  CreatePersonaChat,
  FindPersonaByID,
} from "@/features/persona-page/persona-services/persona-service";
import { DisplayError } from "@/features/ui/error/display-error";
import { LoadingIndicator } from "@/features/ui/loading";

/**
 * Embed variant of /agent/[personaId]/chat. Creates a persona chat and, on
 * success, forwards to the EMBED chat view (/embed/chat/[id]) instead of the
 * full-app /chat/[id]. On access failure it sends the user back to the embed
 * landing (which renders the popup sign-in) rather than the full-app
 * access-denied page that assumes the sidebar layout.
 */
const EmbedCreatePersonaChatPage = () => {
  const { personaId } = useParams();
  const [persona, setPersona] = useState<PersonaModel | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchPersona = async (): Promise<void> => {
      if (!personaId) {
        setErrors(["Agent ID is missing"]);
        return;
      }

      try {
        const personasResponse = await FindPersonaByID(personaId as string);

        if (personasResponse.status === "UNAUTHORIZED") {
          router.push(`/embed/agent/${personaId as string}`);
          return;
        }

        if (personasResponse.status !== "OK") {
          setErrors(personasResponse.errors.map((error) => error.message));
          return;
        }

        setPersona(personasResponse.response);
      } catch (error) {
        setErrors(["An unexpected error occurred while fetching the agent"]);
      }
    };

    fetchPersona();
  }, [personaId, router]);

  useEffect(() => {
    const startChat = async (): Promise<void> => {
      if (!persona) return;

      try {
        const response = await CreatePersonaChat(persona.id as string);

        if (response.status === "OK") {
          router.push(`/embed/chat/${response.response.id}`);
        } else if (response.status === "UNAUTHORIZED") {
          router.push(`/embed/agent/${persona.id}`);
        } else {
          showError(response.errors.map((error) => error.message).join(", "));
        }
      } catch (error) {
        showError("An unexpected error occurred while starting the chat.");
      }
    };

    startChat();
  }, [persona, router]);

  if (errors) {
    return <DisplayError errors={errors.map((error) => ({ message: error }))} />;
  }

  return (
    <div className="container w-full h-full flex items-center justify-center">
      <LoadingIndicator isLoading />
    </div>
  );
};

export default EmbedCreatePersonaChatPage;
