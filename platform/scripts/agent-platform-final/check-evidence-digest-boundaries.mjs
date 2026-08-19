import{scanWorkload}from'./lib.mjs';const report=await scanWorkload();console.log(JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;
