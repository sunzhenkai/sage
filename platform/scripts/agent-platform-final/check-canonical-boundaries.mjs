import{scanCanonical}from'./lib.mjs';const report=await scanCanonical();console.log(JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;
