"use client";

import { signIn } from "next-auth/react";
import { Suspense } from "react";
import { AI_NAME } from "@/features/theme/theme-config";
import { Button } from "@/features/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/features/ui/card";

/**
 * Popup-only login launcher. Loaded as a TOP-LEVEL window (window.open from the
 * embed sign-in card), so Microsoft Entra's iframe restrictions don't apply.
 * Every provider completes at /embed/auth/complete, which postMessages the
 * opener (the iframe) and closes the popup.
 */
function StartInner() {
  const complete = "/embed/auth/complete";
  const isDev = process.env.NODE_ENV === "development";

  return (
    <main className="flex items-center justify-center min-h-screen p-4">
      <Card className="min-w-[300px]">
        <CardHeader>
          <CardTitle className="text-xl">{AI_NAME}</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button onClick={() => signIn("azure-ad", { callbackUrl: complete })}>
            Microsoft Entra
          </Button>
          {isDev && (
            <Button
              variant="outline"
              onClick={() => signIn("localdev", { callbackUrl: complete })}
            >
              Basic Auth (DEV ONLY)
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export default function EmbedAuthStart() {
  // useSearchParams (used indirectly by next-auth) requires a Suspense boundary
  // for static generation; force-dynamic on the layout covers runtime.
  return (
    <Suspense>
      <StartInner />
    </Suspense>
  );
}
