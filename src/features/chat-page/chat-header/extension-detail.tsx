import { ExtensionModel } from "@/features/extensions-page/extension-services/models";
import { Button } from "@/features/ui/button";
import { ScrollArea } from "@/features/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/features/ui/sheet";
import { Switch } from "@/features/ui/switch";
import { Globe, PocketKnife } from "lucide-react";
import { FC } from "react";
import {
  AddExtensionToChatThread,
  RemoveExtensionFromChatThread,
} from "../chat-services/chat-thread-service";
import { showError } from "@/features/globals/global-message-store";
import { RevalidateCache } from "@/features/common/navigation-helpers";
import { personaStore } from "@/features/persona-page/persona-store";

interface Props {
  extensions: Array<ExtensionModel>;
  chatThreadId: string;
  installedExtensionIds: Array<string>;
  disabled: boolean;
  parent: string;
}

export const ExtensionDetail: FC<Props> = (props) => {
  const toggleInstall = async (isChecked: boolean, extensionId: string) => {
    if (props.parent !== "chat") {
      if (isChecked) personaStore.addExtension(extensionId);
      else personaStore.removeExtension(extensionId);
      return;
    }
    const response = isChecked
      ? await AddExtensionToChatThread({ extensionId, chatThreadId: props.chatThreadId })
      : await RemoveExtensionFromChatThread({ extensionId, chatThreadId: props.chatThreadId });
    RevalidateCache({ page: "chat", type: isChecked ? "layout" : undefined });
    if (response.status !== "OK") {
      showError(response.errors[0].message);
    }
  };

  const installedCount = props.installedExtensionIds?.length ?? 0;
  const totalCount = props.extensions.length;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant={"outline"}
          className="gap-2"
          disabled={props.disabled}
          aria-label="Current Chat Extensions Menu"
        >
          <PocketKnife size={16} />
          {installedCount > 0 && (
            <span className="text-xs bg-primary/10 text-primary rounded-full px-1.5 py-0.5 font-medium">{installedCount}</span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="min-w-[480px] sm:w-[540px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Extensions</SheetTitle>
          <SheetDescription>
            Enhance your AI Chat with added tools and features for extended
            functionality and smarter interactions.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1 -mx-6 flex" type="always">
          <div className="pb-6 px-6 flex gap-4 flex-col  flex-1">
            {props.extensions.map((extension) => {
              const isInstalled =
                props.installedExtensionIds?.includes(extension.id) ?? false;
              return (
                <div
                  className="flex gap-2 p-4 items-center justify-between border rounded-md"
                  key={extension.id}
                >
                  <div className="flex flex-col gap-2 flex-1">
                    <div>{extension.name}</div>
                    <div className="text-muted-foreground">
                      {extension.description}
                    </div>
                  </div>
                  <div>
                    {extension.name !== "Bing Search" ||
                    props.parent !== "chat" ? (
                      <Switch
                        defaultChecked={isInstalled}
                        onCheckedChange={(e) => toggleInstall(e, extension.id)}
                      />
                    ) : (
                      <Globe />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
