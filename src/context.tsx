"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DependencyList,
  type PropsWithChildren,
} from "react";
import { ScopedRegistry } from "./registry";
import type {
  CommandChoice,
  NeedleEngine,
  NeedleRunOptions,
  NeedleRunResult,
  NeedleTool,
  NeedleWasmOptions,
} from "./types";

interface RegisteredTool {
  id: string;
  tool: NeedleTool;
}

interface PreloadableNeedleEngine extends NeedleEngine {
  preload(): Promise<void>;
}

export interface SuperCmdKProviderProps extends PropsWithChildren {
  /** Commands available everywhere beneath this provider. */
  commands?: readonly CommandChoice[];
  /** Needle tools available everywhere beneath this provider. */
  tools?: readonly NeedleTool[];
  /** Omit this to use the palette without Needle. No model assets are redistributed. */
  needle?: NeedleWasmOptions;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Cmd/Ctrl+K by default. Pass false to disable or a predicate for a custom hotkey. */
  hotkey?: false | ((event: KeyboardEvent) => boolean);
}

export interface SuperCmdKController {
  open: boolean;
  setOpen: (open: boolean) => void;
  commands: readonly CommandChoice[];
  tools: readonly NeedleTool[];
  needleEnabled: boolean;
  /** Lazily download and compile Needle in its Worker without starting a session. */
  preloadNeedle: () => Promise<void>;
  runNeedle: (input: string, options?: NeedleRunOptions) => Promise<NeedleRunResult>;
}

interface SuperCmdKContextValue {
  commandRegistry: ScopedRegistry<CommandChoice>;
  toolRegistry: ScopedRegistry<RegisteredTool>;
  globalCommands: readonly CommandChoice[];
  globalTools: readonly NeedleTool[];
  open: boolean;
  setOpen: (open: boolean) => void;
  needleEnabled: boolean;
  preloadNeedle: SuperCmdKController["preloadNeedle"];
  runNeedle: SuperCmdKController["runNeedle"];
}

const EMPTY_COMMANDS: readonly CommandChoice[] = [];
const EMPTY_REGISTERED_TOOLS: readonly RegisteredTool[] = [];
const SuperCmdKContext = createContext<SuperCmdKContextValue | null>(null);

function mergeCommands(globalItems: readonly CommandChoice[], localItems: readonly CommandChoice[]): readonly CommandChoice[] {
  const merged = new Map(globalItems.map((item) => [item.id, item]));
  for (const item of localItems) merged.set(item.id, item);
  return [...merged.values()].sort((a, b) =>
    (b.priority ?? 0) - (a.priority ?? 0) || a.label.localeCompare(b.label),
  );
}

function mergeTools(globalItems: readonly NeedleTool[], localItems: readonly RegisteredTool[]): readonly NeedleTool[] {
  const merged = new Map(globalItems.map((tool) => [tool.name, tool]));
  for (const { tool } of localItems) merged.set(tool.name, tool);
  return [...merged.values()];
}

function defaultHotkey(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

function optionsKey(options: NeedleWasmOptions): string {
  return JSON.stringify([
    options.glueUrl,
    options.wasmUrl,
    options.modelUrl,
    options.workerUrl?.toString(),
    options.bufferSize,
    options.maxNewTokens,
  ]);
}

export function SuperCmdKProvider({
  children,
  commands = EMPTY_COMMANDS,
  tools = [],
  needle,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  hotkey,
}: SuperCmdKProviderProps) {
  const [commandRegistry] = useState(() => new ScopedRegistry<CommandChoice>());
  const [toolRegistry] = useState(() => new ScopedRegistry<RegisteredTool>());
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const globalsRef = useRef({ commands, tools });
  globalsRef.current = { commands, tools };
  const clientRef = useRef<{ key: string; client: PreloadableNeedleEngine } | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  const setOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);

  useEffect(() => {
    const predicate = hotkey === false ? null : hotkey ?? defaultHotkey;
    if (!predicate) return;
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || !predicate(event)) return;
      event.preventDefault();
      setOpen(!open);
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [hotkey, open, setOpen]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clientRef.current?.client.dispose();
      clientRef.current = null;
    };
  }, []);

  const getNeedleClient = useCallback(async (): Promise<PreloadableNeedleEngine> => {
    if (!needle) throw new Error("Needle is not configured on SuperCmdKProvider.");
    const { NeedleWasmClient } = await import("./needle/runtime");
    if (!mountedRef.current) throw new Error("SuperCmdKProvider was unmounted.");
    const key = optionsKey(needle);
    if (clientRef.current?.key !== key) {
      clientRef.current?.client.dispose();
      clientRef.current = { key, client: new NeedleWasmClient(needle) };
    }
    return clientRef.current.client;
  }, [needle]);

  const preloadNeedle = useCallback(async (): Promise<void> => {
    const client = await getNeedleClient();
    await client.preload();
  }, [getNeedleClient]);

  const runNeedle = useCallback((input: string, options?: NeedleRunOptions): Promise<NeedleRunResult> => {
    const perform = async () => {
      const [{ runNeedleChain }, client] = await Promise.all([
        import("./needle/runtime"),
        getNeedleClient(),
      ]);
      if (!needle) throw new Error("Needle is not configured on SuperCmdKProvider.");
      const registered = toolRegistry.getSnapshot();
      const availableTools = mergeTools(globalsRef.current.tools, registered);
      if (availableTools.length === 0) throw new Error("No Needle tools are registered.");
      const systemPrompt = options?.systemPrompt ?? (typeof needle.systemPrompt === "function"
        ? needle.systemPrompt()
        : needle.systemPrompt ?? "");
      try {
        return await runNeedleChain(client, input, availableTools, { ...options, systemPrompt });
      } catch (error) {
        // A failed Worker cannot reliably accept later messages. Recreate it on the next run.
        if (clientRef.current?.client === client) {
          client.dispose();
          clientRef.current = null;
        }
        throw error;
      }
    };

    const result = queueRef.current.then(perform, perform);
    queueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, [getNeedleClient, needle, toolRegistry]);

  const value = useMemo<SuperCmdKContextValue>(() => ({
    commandRegistry,
    toolRegistry,
    globalCommands: commands,
    globalTools: tools,
    open,
    setOpen,
    needleEnabled: Boolean(needle),
    preloadNeedle,
    runNeedle,
  }), [commandRegistry, toolRegistry, commands, tools, open, setOpen, needle, preloadNeedle, runNeedle]);

  return <SuperCmdKContext.Provider value={value}>{children}</SuperCmdKContext.Provider>;
}

function useContextValue(): SuperCmdKContextValue {
  const value = useContext(SuperCmdKContext);
  if (!value) throw new Error("SuperCmdK hooks and components must be inside SuperCmdKProvider.");
  return value;
}

/** Register choices for the lifetime of the calling component (usually a page or route). */
export function useCommandChoices(commands: readonly CommandChoice[], dependencies: DependencyList = [commands]): void {
  const { commandRegistry } = useContextValue();
  useEffect(() => commandRegistry.register(commands), [commandRegistry, ...dependencies]);
}

export function useCommandChoice(command: CommandChoice, dependencies: DependencyList = [command]): void {
  useCommandChoices([command], dependencies);
}

/** Register callable Needle functions for the lifetime of the calling component. */
export function useNeedleTools(tools: readonly NeedleTool[], dependencies: DependencyList = [tools]): void {
  const { toolRegistry } = useContextValue();
  useEffect(
    () => toolRegistry.register(tools.map((tool) => ({ id: tool.name, tool }))),
    [toolRegistry, ...dependencies],
  );
}

export function useNeedleTool(tool: NeedleTool, dependencies: DependencyList = [tool]): void {
  useNeedleTools([tool], dependencies);
}

export function useSuperCmdK(): SuperCmdKController {
  const context = useContextValue();
  const localCommands = useSyncExternalStore(
    context.commandRegistry.subscribe,
    context.commandRegistry.getSnapshot,
    () => EMPTY_COMMANDS,
  );
  const localTools = useSyncExternalStore(
    context.toolRegistry.subscribe,
    context.toolRegistry.getSnapshot,
    () => EMPTY_REGISTERED_TOOLS,
  );
  const commands = useMemo(
    () => mergeCommands(context.globalCommands, localCommands),
    [context.globalCommands, localCommands],
  );
  const tools = useMemo(
    () => mergeTools(context.globalTools, localTools),
    [context.globalTools, localTools],
  );

  return {
    open: context.open,
    setOpen: context.setOpen,
    commands,
    tools,
    needleEnabled: context.needleEnabled,
    preloadNeedle: context.preloadNeedle,
    runNeedle: context.runNeedle,
  };
}
