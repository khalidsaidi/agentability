export {};

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: unknown[];
  }
}
