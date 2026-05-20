export {};

declare global {
  interface Window {
    electron?: {
      platform: NodeJS.Platform;
      versions: {
        electron: string;
        chrome: string;
        node: string;
      };
    };
  }
}
