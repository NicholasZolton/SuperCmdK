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
import { ToolRegistry, createToolRegistry } from "./tools/registry";
import type {
  CommandChoice,
  AgentEngine,
  AgentOptions,
  AgentRunOptions,
  AgentRunResult,
  Tool,
  ToolInvocationResult,
  ToolInvokeOptions,
  ToolPolicy,
} from "./types";

interface PreloadableAgentEngine extends AgentEngine {
  preload?: () => Promise<void>;
}

export interface SuperCmdKProviderProps extends PropsWithChildren {
  /** Commands available everywhere beneath this provider. */
  commands?: readonly CommandChoice[];
  /** Tools available everywhere beneath this provider, independent of any Agent engine. */
  tools?: readonly Tool[];
  /** Optional shared registry for non-React consumers such as voice or automation adapters. */
  toolRegistry?: ToolRegistry;
  /** Central authorization and confirmation policy for every tool invocation. */
  toolPolicy?: ToolPolicy;
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
  tools: readonly Tool[];
  invokeTool: <TResult = unknown>(
    name: string,
    arguments_: unknown,
    options?: ToolInvokeOptions,
  ) => Promise<ToolInvocationResult<TResult>>;
  agentEnabled: boolean;
  /** Lazily download and compile the Agent engine in its Worker without starting a session. */
  preloadAgent: () => Promise<void>;
  runAgent: (input: string, options?: AgentRunOptions) => Promise<AgentRunResult>;
}

interface SuperCmdKContextValue {
  commandRegistry: ScopedRegistry<CommandChoice>;
  toolRegistry: ToolRegistry;
  globalCommands: readonly CommandChoice[];
  open: boolean;
  setOpen: (open: boolean) => void;
  agentEnabled: boolean;
  preloadAgent: SuperCmdKController["preloadAgent"];
  runAgent: SuperCmdKController["runAgent"];
}

const EMPTY_COMMANDS: readonly CommandChoice[] = [];
const EMPTY_TOOLS: readonly Tool[] = [];
const SuperCmdKContext = createContext<SuperCmdKContextValue | null>(null);

function mergeCommands(globalItems: readonly CommandChoice[], localItems: readonly CommandChoice[]): readonly CommandChoice[] {
  const merged = new Map(globalItems.map((item) => [item.id, item]));
  for (const item of localItems) merged.set(item.id, item);
  return [...merged.values()].sort((a, b) =>
    (b.priority ?? 0) - (a.priority ?? 0) || a.label.localeCompare(b.label),
  );
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
  tools = EMPTY_TOOLS,
  toolRegistry: externalToolRegistry,
  toolPolicy,
  agent,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  hotkey,
}: SuperCmdKProviderProps) {
  const [commandRegistry] = useState(() => new ScopedRegistry<CommandChoice>());
  const [internalToolRegistry] = useState(() => createToolRegistry({ tools }));
  const toolRegistry = externalToolRegistry ?? internalToolRegistry;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const globalsRef = useRef({ commands });
  globalsRef.current = { commands };
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const engineSource = agent?.engine;
  const clientRef = useRef<{ source: AgentOptions["engine"]; client: PreloadableAgentEngine } | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  useEffect(() => {
    if (toolPolicy === undefined) return;
    const registration = toolRegistry.registerPolicy(toolPolicy);
    return () => registration.dispose();
  }, [toolRegistry, toolPolicy]);

  useEffect(() => {
    if (externalToolRegistry && tools === EMPTY_TOOLS) return;
    toolRegistry.setBaseTools(tools);
  }, [externalToolRegistry, toolRegistry, tools]);

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
      const availableTools = toolRegistry.getSnapshot();
      if (availableTools.length === 0) throw new Error("No Agent tools are registered.");
      const systemPrompt = options?.systemPrompt ?? (typeof agent.systemPrompt === "function"
        ? agent.systemPrompt()
        : agent.systemPrompt ?? "");
      try {
        const policy = toolRegistry.getPolicy();
        return await runAgentChain(client, input, availableTools, {
          ...options,
          systemPrompt,
          ...(policy ? { toolPolicy: policy } : {}),
        });
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
    open,
    setOpen,
    agentEnabled: Boolean(agent),
    preloadAgent,
    runAgent,
  }), [commandRegistry, toolRegistry, commands, open, setOpen, agent, preloadAgent, runAgent]);

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

/** Register generic tools for the lifetime of the calling component. */
export function useTools(tools: readonly Tool[], dependencies: DependencyList = [tools]): void {
  const { toolRegistry } = useContextValue();
  useEffect(() => {
    const registration = toolRegistry.register(tools);
    return () => registration.dispose();
  }, [toolRegistry, ...dependencies]);
}

export function useTool(tool: Tool, dependencies: DependencyList = [tool]): void {
  useTools([tool], dependencies);
}

/** @deprecated Use `useTools`. */
export const useAgentTools = useTools;

/** @deprecated Use `useTool`. */
export const useAgentTool = useTool;

export function useSuperCmdK(): SuperCmdKController {
  const context = useContextValue();
  const localCommands = useSyncExternalStore(
    context.commandRegistry.subscribe,
    context.commandRegistry.getSnapshot,
    () => EMPTY_COMMANDS,
  );
  const tools = useSyncExternalStore(
    context.toolRegistry.subscribe,
    context.toolRegistry.getSnapshot,
    () => EMPTY_TOOLS,
  );
  const commands = useMemo(
    () => mergeCommands(context.globalCommands, localCommands),
    [context.globalCommands, localCommands],
  );
  const invokeTool = useCallback<SuperCmdKController["invokeTool"]>(
    (name, arguments_, options) => context.toolRegistry.invokeTool(name, arguments_, options),
    [context.toolRegistry],
  );

  return {
    open: context.open,
    setOpen: context.setOpen,
    commands,
    tools,
    invokeTool,
    agentEnabled: context.agentEnabled,
    preloadAgent: context.preloadAgent,
    runAgent: context.runAgent,
  };
}
