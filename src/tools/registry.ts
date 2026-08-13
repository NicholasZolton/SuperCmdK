import { invokeTool } from "./invoke";
import type {
  Tool,
  ToolInvocationResult,
  ToolInvokeOptions,
  ToolPolicy,
  ToolPolicyRegistration,
  ToolRegistration,
  ToolRegistryOptions,
  ToolResolver,
} from "./types";

type Listener = () => void;

function validateTools(tools: readonly Tool[]): readonly Tool[] {
  const names = new Set<string>();
  for (const tool of tools) {
    if (!tool.name.trim()) throw new Error("Registered tools must have a non-empty name.");
    if (names.has(tool.name)) throw new Error(`Duplicate tool name in one scope: ${tool.name}`);
    names.add(tool.name);
  }
  return tools.slice();
}

/** React-independent, observable registry with scoped override and restoration semantics. */
export class ToolRegistry implements ToolResolver {
  readonly #scopes = new Map<symbol, readonly Tool[]>();
  readonly #policyScopes = new Map<symbol, ToolPolicy>();
  readonly #listeners = new Set<Listener>();
  #snapshot: readonly Tool[] = [];
  #baseTools: readonly Tool[] = [];
  #basePolicy: ToolPolicy | undefined;

  constructor(options: ToolRegistryOptions = {}) {
    this.#basePolicy = options.policy;
    this.#baseTools = validateTools(options.tools ?? []);
    this.#publish();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): readonly Tool[] => this.#snapshot;

  getTool = (name: string): Tool | undefined => this.#snapshot.find((tool) => tool.name === name);

  getPolicy = (): ToolPolicy | undefined => {
    let policy = this.#basePolicy;
    for (const scopedPolicy of this.#policyScopes.values()) policy = scopedPolicy;
    return policy;
  };

  getBaseTools = (): readonly Tool[] => this.#baseTools;

  setPolicy(policy: ToolPolicy | undefined): void {
    this.#basePolicy = policy;
  }

  registerPolicy(policy: ToolPolicy): ToolPolicyRegistration {
    const scope = Symbol("supercmdk-tool-policy-scope");
    this.#policyScopes.set(scope, policy);
    let disposed = false;
    return {
      update: (nextPolicy) => {
        if (disposed) throw new Error("Cannot update a disposed tool policy registration.");
        this.#policyScopes.set(scope, nextPolicy);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.#policyScopes.delete(scope);
      },
    };
  }

  /** Replace the lowest-priority base scope while preserving route/component overrides. */
  setBaseTools(tools: readonly Tool[]): void {
    this.#baseTools = validateTools(tools);
    this.#publish();
  }

  register(tools: readonly Tool[]): ToolRegistration {
    const scope = Symbol("supercmdk-tool-scope");
    this.#scopes.set(scope, validateTools(tools));
    this.#publish();
    let disposed = false;

    return {
      update: (nextTools) => {
        if (disposed) throw new Error("Cannot update a disposed tool registration.");
        this.#scopes.set(scope, validateTools(nextTools));
        this.#publish();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.#scopes.delete(scope)) this.#publish();
      },
    };
  }

  invokeTool<TResult = unknown>(
    name: string,
    arguments_: unknown,
    options?: ToolInvokeOptions,
  ): Promise<ToolInvocationResult<TResult>> {
    return invokeTool<TResult>(this, name, arguments_, options);
  }

  #publish(): void {
    const byName = new Map(this.#baseTools.map((tool) => [tool.name, tool]));
    for (const tools of this.#scopes.values()) {
      for (const tool of tools) byName.set(tool.name, tool);
    }
    this.#snapshot = Object.freeze([...byName.values()]);
    for (const listener of this.#listeners) listener();
  }
}

export function createToolRegistry(options?: ToolRegistryOptions): ToolRegistry {
  return new ToolRegistry(options);
}
