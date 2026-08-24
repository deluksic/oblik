/// <reference types="vite/client" />

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "virtual:oblik-annotations?*" {
  import type { Annotation } from "oblik";
  const annotations: Record<string, Annotation>;
  export default annotations;
}
