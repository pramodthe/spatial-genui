// Types for kit.js (plain JavaScript shared with the headset; see the header there).
export const KIT_VERSION: number;

export type Kit = {
  material(preset?: string, options?: Record<string, unknown>): unknown;
  texture(kind: string, options?: Record<string, unknown>): unknown;
  theme(options?: { accent?: string }): string;
  /** Host hooks: real-world texture scale after build(), background painting per frame, cleanup. */
  finalize(root: unknown): void;
  pump(budgetMs?: number): number;
  dispose(): void;
  presets: string[];
  textures: string[];
  [helper: string]: unknown;
};

export function createKit(THREE: unknown, options?: { dry?: boolean }): Kit;
