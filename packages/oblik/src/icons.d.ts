/** unplugin-icons ships Solid 1 typings; Solid 2 needs local module declarations. */
declare module "~icons/*" {
  import type { JSX } from "solid-js";

  type IconProps = {
    class?: string;
    "aria-hidden"?: boolean | "true" | "false";
    width?: string | number;
    height?: string | number;
    style?: string | Record<string, string | number>;
  };

  const component: (props: IconProps) => JSX.Element;
  export default component;
}
