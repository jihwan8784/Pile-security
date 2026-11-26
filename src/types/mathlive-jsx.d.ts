// <math-field> (MathLive 수식 입력창)을 JSX에서 쓸 수 있도록 타입을 알려 준다
import type { MathfieldElement } from "mathlive"
import type { DetailedHTMLProps, HTMLAttributes } from "react"

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "math-field": DetailedHTMLProps<HTMLAttributes<MathfieldElement>, MathfieldElement> & {
        "math-virtual-keyboard-policy"?: "auto" | "manual" | "sandboxed"
        "smart-fence"?: "on" | "off"
      }
    }
  }
}
