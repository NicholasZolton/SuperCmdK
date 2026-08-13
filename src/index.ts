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

export {
  SuperCmdKProvider,
  useCommandChoice,
  useCommandChoices,
  useAgentTool,
  useAgentTools,
  useTool,
  useTools,
  useSuperCmdK,
  type SuperCmdKController,
  type SuperCmdKProviderProps,
} from "./context";
export { CommandPalette, type CommandPaletteProps } from "./palette";
export { createToolRegistry, invokeTool, ToolRegistry } from "./tools";
export type {
  CommandChoice,
  CommandExecutionContext,
  JsonSchema,
  MaybePromise,
  AgentEngine,
  AgentExecutedCall,
  AgentOptions,
  AgentResponse,
  AgentRunOptions,
  AgentRunResult,
  AgentTool,
  AgentToolCall,
  AgentToolContext,
  AgentToolSchema,
  Tool,
  ToolAnnotations,
  ToolContext,
  ToolInvocationError,
  ToolInvocationErrorCode,
  ToolInvocationRequest,
  ToolInvocationResult,
  ToolInvokeOptions,
  ToolPolicy,
  ToolPolicyRegistration,
  ToolRegistration,
  ToolRegistryOptions,
  ToolResolver,
  ToolSchema,
  ToolValidationIssue,
  NeedleWasmEngineOptions,
} from "./types";
