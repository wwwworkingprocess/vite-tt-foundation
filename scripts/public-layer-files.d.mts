import type * as fs from 'node:fs';
import type * as promises from 'node:fs/promises';
export declare const readFileSync: typeof fs.readFileSync;
export declare const readFile: typeof promises.readFile;
export declare const readdir: typeof promises.readdir;
export declare function readLayerFile(root: URL, path: string): Buffer;
