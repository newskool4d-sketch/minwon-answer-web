import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'dist');
if(relative(root,output)!=='dist')throw new Error('Unexpected build output path.');
await rm(output,{recursive:true,force:true});
await mkdir(output);
const files=['index.html','app.js','styles.css'];
await Promise.all(files.map(file=>copyFile(join(root,'public',file),join(output,file))));
if((await readdir(output)).length!==files.length)throw new Error('Unexpected file in web output.');
console.log('Static web build complete: index.html, app.js, styles.css. Local AI/auth files are excluded.');
