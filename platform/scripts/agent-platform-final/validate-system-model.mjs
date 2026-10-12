import{validateModel}from'./lib.mjs';const report=await validateModel();console.log(JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;
