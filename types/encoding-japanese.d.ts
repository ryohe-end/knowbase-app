// encoding-japanese の最小型定義 (公式に型同梱なしのため)
declare module "encoding-japanese" {
  export function stringToCode(s: string): number[];
  export function codeToString(code: number[]): string;
  export function convert(
    data: number[] | Uint8Array,
    to: string | { to: string; from?: string; type?: string },
    from?: string
  ): number[];
  export function toKatakanaCase(code: number[]): number[];
  export function toHankanaCase(code: number[]): number[];
  export function toHankakuCase(code: number[]): number[];
  export function toHankakuSpace(code: number[]): number[];
  const Encoding: {
    stringToCode: typeof stringToCode;
    codeToString: typeof codeToString;
    convert: typeof convert;
    toKatakanaCase: typeof toKatakanaCase;
    toHankanaCase: typeof toHankanaCase;
    toHankakuCase: typeof toHankakuCase;
    toHankakuSpace: typeof toHankakuSpace;
  };
  export default Encoding;
}
