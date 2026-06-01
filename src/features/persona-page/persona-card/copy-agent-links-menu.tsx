"use client";

import { DropdownMenuItemWithIcon } from "@/features/chat-page/chat-menu/chat-menu-item";
import { Check, Clipboard, Code2, ExternalLink, Link as LinkIcon } from "lucide-react";
import { FC, useEffect, useState } from "react";
import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";

export interface AgentEmbedLinks {
  /** Deep link that opens a new chat with the agent in the full app. */
  agentLink: string;
  /** Direct link to the iframe-friendly embed landing for the agent. */
  embeddableLink: string;
  /** Ready-to-paste <iframe> snippet wrapping the embeddable link. */
  embedSnippet: string;
}

/** Pure builder so the link/snippet strings can be unit-tested without the UI. */
export const buildAgentEmbedLinks = (
  baseUrl: string,
  personaId: string
): AgentEmbedLinks => {
  const agentLink = `${baseUrl}/agent/${personaId}/chat`;
  const embeddableLink = `${baseUrl}/embed/agent/${personaId}`;
  const embedSnippet = `<iframe src="${embeddableLink}" title="Bühler Chat agent" width="420" height="640" style="border:0;border-radius:12px" allow="clipboard-write"></iframe>`;
  return { agentLink, embeddableLink, embedSnippet };
};

interface Props {
  personaId: string;
}

/**
 * Single copy control on the agent card: a dropdown that copies the agent link,
 * the embeddable link, or a full <iframe> embed snippet. Replaces the two
 * separate copy icon buttons.
 */
export const CopyAgentLinksMenu: FC<Props> = ({ personaId }) => {
  const [baseUrl, setBaseUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin);
    }
  }, []);

  const { agentLink, embeddableLink, embedSnippet } = buildAgentEmbedLinks(
    baseUrl,
    personaId
  );

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Copy agent links"
          size={"icon"}
          className="flex items-center gap-2 px-[5px] py-2 rounded transition-colors"
        >
          {copied ? <Check size={18} /> : <Clipboard size={18} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Copy</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItemWithIcon onClick={() => copy(agentLink)}>
          <LinkIcon size={16} />
          <span>Agent link</span>
        </DropdownMenuItemWithIcon>
        <DropdownMenuItemWithIcon onClick={() => copy(embeddableLink)}>
          <ExternalLink size={16} />
          <span>Embeddable link</span>
        </DropdownMenuItemWithIcon>
        <DropdownMenuItemWithIcon onClick={() => copy(embedSnippet)}>
          <Code2 size={16} />
          <span>Embed snippet (iframe)</span>
        </DropdownMenuItemWithIcon>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
