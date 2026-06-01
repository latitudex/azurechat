import { FC } from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../ui/card";
import { PersonaModel } from "../persona-services/models";
import { PersonaCardContextMenu } from "./persona-card-context-menu";
import { ViewPersona } from "./persona-view";
import { StartNewPersonaChat } from "./start-new-persona-chat";
import { CopyAgentLinksMenu } from "./copy-agent-links-menu";
import { PersonaVisibilityInfo } from "./persona-visibility-info";
import { FavoriteAgentButton } from "./favorite-agent-button";

interface Props {
  persona: PersonaModel;
  showContextMenu: boolean;
  showActionMenu: boolean;
  isFavorited?: boolean;
  onToggleFavorite?: (agentId: string) => void;
}

export const PersonaCard: FC<Props> = (props) => {
  const { persona } = props;

  return (
    <Card key={persona.id} data-persona-id={persona.id} className="flex flex-col">
      <CardHeader className="flex flex-row gap-2 items-start">
        <div className="flex flex-1 items-center gap-2">
          <CardTitle className="flex-1 line-clamp-1">{persona.name}</CardTitle>
          <PersonaVisibilityInfo persona={persona} />
          {props.onToggleFavorite && (
            <FavoriteAgentButton
              agentId={persona.id}
              isFavorited={props.isFavorited ?? false}
              onToggle={props.onToggleFavorite}
            />
          )}
        </div>
        {props.showActionMenu && (
          <div>
            <PersonaCardContextMenu persona={persona} />
          </div>
        )}
      </CardHeader>
      <CardContent className="text-muted-foreground flex-1 line-clamp-3">
        {persona.description}
      </CardContent>
      <CardFooter className="gap-1 content-stretch f">
        {props.showContextMenu && <ViewPersona persona={persona} />}
        <StartNewPersonaChat persona={persona} />
        <CopyAgentLinksMenu personaId={persona.id} />
      </CardFooter>
    </Card>
  );
};
