export interface RenderAdapter {
  beforeUpdate?(component: any): void;
  render?(component: any, renderFn: () => any): any;
  afterUpdate?(component: any, output: any): void;
  onConnect?(component: any): boolean | void;
  onDisconnect?(component: any): boolean | void;
  cleanup?(component: any): void;
  onError?(component: any): void;
}

export declare function registerRenderAdapter(adapter: RenderAdapter): () => void;
export declare function getRenderAdapter(): RenderAdapter | null;
