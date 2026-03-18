declare module "sql.js" {
  export type BindParams = Record<string, unknown> | unknown[] | null | undefined;

  export interface Statement {
    bind(values?: BindParams): boolean;
    step(): boolean;
    getAsObject(params?: BindParams): Record<string, unknown>;
    get(params?: BindParams): unknown[];
    getColumnNames(): string[];
    free(): void;
    run(values?: BindParams): void;
  }

  export interface Database {
    run(sql: string, params?: BindParams): Database;
    exec(sql: string, params?: BindParams): Array<{ columns: string[]; values: unknown[][] }>;
    prepare(sql: string, params?: BindParams): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | ArrayLike<number>) => Database;
  }

  export type InitSqlJsOptions = {
    locateFile?: (file: string) => string;
  };

  export default function initSqlJs(options?: InitSqlJsOptions): Promise<SqlJsStatic>;
}
