"use client";

// Keep the complete cmdk primitive API available for consumers that need custom composition.
export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandRoot,
  CommandSeparator,
  defaultFilter,
  useCommandState,
} from "cmdk";

export { CommandPalette, type CommandPaletteProps } from "./palette";
