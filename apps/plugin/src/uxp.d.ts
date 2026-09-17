declare module 'photoshop' {
  export const app: {
    documents: Array<{ id: number; title: string; width: number; height: number }>;
    activeDocument?: { id: number; title: string; activeLayers: Array<{ id: number; name: string }> };
  };
  export const core: {
    executeAsModal: (fn: (ctx: { isCancelled: boolean; hostControl: {
      suspendHistory: (opts: { documentID: number; name: string }) => Promise<unknown>;
      resumeHistory: (suspension: unknown, commit: boolean) => Promise<void>;
    } }) => Promise<unknown>, opts: { commandName: string }) => Promise<unknown>;
  };
  export const imaging: {
    getPixels: (opts: unknown) => Promise<{ imageData: { width: number; height: number; dispose: () => void }; sourceBounds: { left: number; top: number; right: number; bottom: number }; level: number }>;
    putPixels: (opts: unknown) => Promise<void>;
    createImageDataFromBuffer: (buffer: Uint8Array, opts: unknown) => Promise<{ dispose: () => void }>;
  };
}

declare module 'uxp' {
  export const storage: {
    formats: { utf8: string; binary: string };
    localFileSystem: {
      getFileForSaving: (name: string, opts?: unknown) => Promise<{ write: (data: Buffer | Uint8Array | string) => Promise<void> } | null>;
      getFileForOpening: (opts?: unknown) => Promise<{ read: (opts?: { format?: string }) => Promise<string> } | null>;
    };
  };
  export const host: { name?: string; version?: string };
}
