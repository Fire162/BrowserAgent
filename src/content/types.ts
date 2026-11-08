export interface ElementDescriptor {
  id: number;
  tagName: string;
  text: string;
  type?: string;
  role?: string;
  placeholder?: string;
  ariaLabel?: string;
  name?: string;
  href?: string;
  value?: string;
  selector: string;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: ElementDescriptor[];
  bodyTextSnippet: string;
}
