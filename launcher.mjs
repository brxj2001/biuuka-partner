import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {stateDir,migrateState} from './state.mjs';
import {selectApplication} from './update.mjs';
await migrateState();
await import(pathToFileURL(path.join(await selectApplication(path.dirname(fileURLToPath(import.meta.url)),stateDir),'cli.mjs')));
