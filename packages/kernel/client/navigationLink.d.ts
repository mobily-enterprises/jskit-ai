import type { DefineComponent } from "vue";
import type { JskitNavigationTarget } from "../shared/navigation.js";

export interface JskitDestinationLinkClickOptions {
  target?: string;
  download?: boolean;
}

export function isJskitOrdinaryLinkClick(
  event: Pick<MouseEvent, "defaultPrevented" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  options?: JskitDestinationLinkClickOptions
): boolean;

export const JskitDestinationLink: DefineComponent<{
  to: string | JskitNavigationTarget;
  focus?: "auto" | "heading" | "preserve";
}>;
