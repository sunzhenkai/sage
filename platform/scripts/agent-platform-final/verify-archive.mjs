import{verifyArchive}from'./lib.mjs';const report=await verifyArchive();console.log(JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;
