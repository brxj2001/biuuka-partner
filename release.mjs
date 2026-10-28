import {readFileSync} from 'node:fs';
const metadata = JSON.parse(readFileSync(new URL('./release.json', import.meta.url), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(metadata.version) || !['development','stable'].includes(metadata.channel) || metadata.updateProtocol !== 1) throw Error('Invalid Biuuka release metadata');
export const VERSION = metadata.version;
export const RELEASE = Object.freeze(metadata);
