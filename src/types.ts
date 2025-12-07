export interface AccessibilityTree {
  nodes: any[];
}

export interface MediaStats {
  tag: string;
  src: string;
  duration: number;
  currentTime: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
  readyState: number;
}

export interface WebGLCanvasDetails {
  webgl: boolean;
  width?: number;
  height?: number;
  contextType?: string;
  extensions?: string[];
}

export interface HeapSnapshot {
  nodes?: any[];
  // Add more fields as needed for heap profile
}

export interface ServiceWorkerInfo {
  registrations?: any;
}
/**
 * types.ts
 * 
 * تمام TypeScript type و interface های پروژه Ultimate DevTools Extractor
 */

export interface NetworkRequestRecord {
  id: string;
  timestamp: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string | null;
  resourceType: string;
}

export interface NetworkResponseRecord {
  id: string;
  timestamp: string;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodySnippet?: string | null;
  fullBodyPath?: string | null;
}

export interface ConsoleRecord {
  timestamp: string;
  type: 'log' | 'warn' | 'error' | 'info' | 'debug';
  text: string;
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
}

export interface PageErrorRecord {
  timestamp: string;
  message: string;
  stack?: string;
}

export interface DialogRecord {
  timestamp: string;
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
}

export interface ClickedElementInfo {
  clickedAt: string;
  tagName: string;
  id?: string | null;
  className?: string | null;
  innerText?: string | null;
  attributes: Record<string, string>;
  cssSelectorGuess: string | null;
  boundingRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface CDPEventListener {
  type: string;
  useCapture: boolean;
  passive: boolean;
  once: boolean;
  handler: string;
  origin: string;
}

export interface SourcesInfo {
  scripts: string[];
  inlineCount: number;
  stack?: string;
}

export interface StorageInfo {
  cookies: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  indexedDB: Record<string, any>;
}

export interface SecurityInfo {
  isSecureContext: boolean;
  location: string;
  origin: string;
}

export interface PerformanceInfo {
  navigationTiming?: any;
  resourceTiming?: any;
  jsHeap?: any;
}

export interface FinalAnalysis {
  meta: {
    createdAt: string;
    targetUrl: string;
  };
  clickData: ClickedElementInfo;
  cdpListeners: CDPEventListener[] | null;
  network: {
    requests: NetworkRequestRecord[];
    responses: NetworkResponseRecord[];
  };
  console: {
    logs: ConsoleRecord[];
    pageErrors: PageErrorRecord[];
    dialogs: DialogRecord[];
  };
  scriptsInfo: SourcesInfo;
  cssInfo: any;
  application: {
    cookies: any;
    storageInfo: StorageInfo;
  };
  securityInfo: SecurityInfo;
  performanceTracePath?: string;
  accessibilityTree?: AccessibilityTree;
  mediaStats?: MediaStats[];
  webglDetails?: WebGLCanvasDetails[];
  heapSnapshot?: HeapSnapshot;
  serviceWorkerInfo?: ServiceWorkerInfo;
}

// Extend the Window interface to include saveClickData
interface Window {
  saveClickData?: (clickData: ClickedElementInfo) => void;
}
