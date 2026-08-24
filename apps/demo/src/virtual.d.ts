import type { Annotation } from "oblik";

declare module "virtual:oblik-annotations*" {
  const annotations: Record<string, Annotation>;
  export default annotations;
}
