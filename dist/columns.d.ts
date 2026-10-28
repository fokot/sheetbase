import { type Column } from './types.js';
export declare const column: {
    text(header: string): Column<string>;
    number(header: string): Column<number>;
    boolean(header: string, checked?: string): Column<boolean>;
    json<T>(header: string, validate: (value: unknown) => value is T, version?: string): Column<T>;
    custom<T>(header: string, options: {
        id: string;
        encode: (value: T) => string;
        decode: (text: string) => T;
    }): Column<T>;
};
//# sourceMappingURL=columns.d.ts.map