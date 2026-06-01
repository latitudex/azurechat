import { userSession } from "@/features/auth-page/helpers";
import { EmbedAgentCard } from "@/features/embed/embed-agent-card";
import { EmbedFrame } from "@/features/embed/embed-frame";
import { EmbedSignIn } from "@/features/embed/embed-sign-in";
import { FindPersonaByID } from "@/features/persona-page/persona-services/persona-service";
import { AI_NAME } from "@/features/theme/theme-config";

export const dynamic = "force-dynamic";

interface EmbedAgentParams {
  params: Promise<{ personaId: string }>;
}

/**
 * Embed landing — the "agent card" start screen shown inside an iframe.
 *
 * Auth-gated: when there is no session we reveal nothing about the agent and
 * render the sign-in placeholder (popup login). Once authenticated we show the
 * persona name/description and a "Start chat" CTA.
 */
export default async function EmbedAgentStart(props: EmbedAgentParams) {
  const { personaId } = await props.params;

  const user = await userSession();
  if (!user) {
    return <EmbedSignIn />;
  }

  const personaResponse = await FindPersonaByID(personaId);
  if (personaResponse.status !== "OK") {
    const message =
      personaResponse.status === "UNAUTHORIZED"
        ? "You don't have access to this agent."
        : "Agent not found.";
    return (
      <EmbedFrame title={AI_NAME}>
        <div className="flex items-center justify-center h-full w-full p-4 text-sm text-muted-foreground">
          {message}
        </div>
      </EmbedFrame>
    );
  }

  const persona = personaResponse.response;
  return (
    <EmbedFrame title={persona.name} fullAppHref={`/agent/${persona.id}/chat`}>
      <EmbedAgentCard persona={persona} />
    </EmbedFrame>
  );
}
