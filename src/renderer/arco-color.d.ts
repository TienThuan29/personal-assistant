declare module '@arco-design/color' {
  export function generate(color: string, options: { list: true; dark?: boolean; format?: 'hex' | 'rgb' | 'hsl' }): string[];
}
