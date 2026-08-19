import{protectedManifest}from'./lib.mjs';const phase=process.argv[2]==='before'?'before':'after';console.log(JSON.stringify(await protectedManifest(phase),null,2));
