import{scanPublicSurfaces}from'./lib.mjs';const report=await scanPublicSurfaces();console.log(JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;
