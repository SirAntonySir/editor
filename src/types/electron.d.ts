export {};

declare global {
  interface Window {
    electron?: {
      platform: NodeJS.Platform;
      /** Backend base URL injected by the Electron main process at launch.
       *  Empty string when no override is configured. */
      backendUrl?: string;
      versions: {
        electron: string;
        chrome: string;
        node: string;
      };
    };
  }
}
