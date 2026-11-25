export interface RenderAdapter {
  render?(component: any, renderFn: () => any): any;
}

export declare function registerRenderAdapter(adapter: RenderAdapter): () => void;
export declare function getRenderAdapter(): RenderAdapter | null;
