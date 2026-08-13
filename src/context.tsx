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
  AgentEngine,
  AgentOptions,
  AgentRunOptions,
  AgentRunResult,
  AgentTool,
} from "./types";

interface RegisteredTool {
  id: string;
  tool: AgentTool;
}

interface PreloadableAgentEngine extends AgentEngine {
  preload?: () => Promise<void>;
}

export interface SuperCmdKProviderProps extends PropsWithChildren {
  /** Commands available everywhere beneath this provider. */
  commands?: readonly CommandChoice[];
  /** Agent tools available everywhere beneath this provider. */
  tools?: readonly AgentTool[];
  /** Agent runtime configuration. */
  agent?: AgentOptions;
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
  tools: readonly AgentTool[];
  agentEnabled: boolean;
  /** Lazily download and compile the Agent engine in its Worker without starting a session. */
  preloadAgent: () => Promise<void>;
  runAgent: (input: string, options?: AgentRunOptions) => Promise<AgentRunResult>;
}

interface SuperCmdKContextValue {
  commandRegistry: ScopedRegistry<CommandChoice>;
  toolRegistry: ScopedRegistry<RegisteredTool>;
  globalCommands: readonly CommandChoice[];
  globalTools: readonly AgentTool[];
  open: boolean;
  setOpen: (open: boolean) => void;
  agentEnabled: boolean;
  preloadAgent: SuperCmdKController["preloadAgent"];
  runAgent: SuperCmdKController["runAgent"];
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

function mergeTools(globalItems: readonly AgentTool[], localItems: readonly RegisteredTool[]): readonly AgentTool[] {
  const merged = new Map(globalItems.map((tool) => [tool.name, tool]));
  for (const { tool } of localItems) merged.set(tool.name, tool);
  return [...merged.values()];
}

function defaultHotkey(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

function isEngine(value: AgentOptions["engine"]): value is AgentEngine {
  return typeof value !== "function";
}

export function SuperCmdKProvider({
  children,
  commands = EMPTY_COMMANDS,
  tools = [],
  agent,
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
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const engineSource = agent?.engine;
  const clientRef = useRef<{ source: AgentOptions["engine"]; client: PreloadableAgentEngine } | null>(null);
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

  const getAgentClient = useCallback(async (): Promise<PreloadableAgentEngine> => {
    const source = agentRef.current?.engine;
    if (!source) throw new Error("Agent is not configured on SuperCmdKProvider.");
    if (clientRef.current?.source !== source) {
      clientRef.current?.client.dispose();
      clientRef.current = null;
      const client = isEngine(source) ? source : await source();
      if (!mountedRef.current) {
        client.dispose();
        throw new Error("SuperCmdKProvider was unmounted.");
      }
      clientRef.current = { source, client };
    }
    return clientRef.current.client;
  }, []);

  const preloadAgent = useCallback(async (): Promise<void> => {
    const client = await getAgentClient();
    try {
      await client.preload?.();
    } catch (error) {
      // A background failure must not poison the first explicit run. Let it retry
      // with a fresh Worker when the user invokes the Agent.
      if (clientRef.current?.client === client) {
        client.dispose();
        clientRef.current = null;
      }
      throw error;
    }
  }, [getAgentClient]);

  useEffect(() => {
    if (!engineSource || agent?.preload === false || typeof window === "undefined") return;

    let cancelled = false;
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const warm = () => {
      if (!cancelled) void preloadAgent().catch(() => undefined);
    };
    const schedule = () => {
      if (cancelled) return;
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(warm, { timeout: 4_000 });
      } else {
        timeoutHandle = window.setTimeout(warm, 1_000);
      }
    };

    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", schedule);
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, [engineSource, agent?.preload, preloadAgent]);

  const runAgent = useCallback((input: string, options?: AgentRunOptions): Promise<AgentRunResult> => {
    const perform = async () => {
      const [{ runAgentChain }, client] = await Promise.all([
        import("./agent/run-agent-chain"),
        getAgentClient(),
      ]);
      if (!agent) throw new Error("Agent is not configured on SuperCmdKProvider.");
      const registered = toolRegistry.getSnapshot();
      const availableTools = mergeTools(globalsRef.current.tools, registered);
      if (availableTools.length === 0) throw new Error("No Agent tools are registered.");
      const systemPrompt = options?.systemPrompt ?? (typeof agent.systemPrompt === "function"
        ? agent.systemPrompt()
        : agent.systemPrompt ?? "");
      try {
        return await runAgentChain(client, input, availableTools, { ...options, systemPrompt });
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
  }, [getAgentClient, agent, toolRegistry]);

  const value = useMemo<SuperCmdKContextValue>(() => ({
    commandRegistry,
    toolRegistry,
    globalCommands: commands,
    globalTools: tools,
    open,
    setOpen,
    agentEnabled: Boolean(agent),
    preloadAgent,
    runAgent,
  }), [commandRegistry, toolRegistry, commands, tools, open, setOpen, agent, preloadAgent, runAgent]);

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

/** Register callable Agent functions for the lifetime of the calling component. */
export function useAgentTools(tools: readonly AgentTool[], dependencies: DependencyList = [tools]): void {
  const { toolRegistry } = useContextValue();
  useEffect(
    () => toolRegistry.register(tools.map((tool) => ({ id: tool.name, tool }))),
    [toolRegistry, ...dependencies],
  );
}

export function useAgentTool(tool: AgentTool, dependencies: DependencyList = [tool]): void {
  useAgentTools([tool], dependencies);
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
    agentEnabled: context.agentEnabled,
    preloadAgent: context.preloadAgent,
    runAgent: context.runAgent,
  };
}
